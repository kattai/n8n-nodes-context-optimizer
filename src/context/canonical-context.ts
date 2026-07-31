import { createHash } from 'node:crypto';
import { policyForCategory } from './categories';
import type {
	CanonicalContext,
	CanonicalContextInput,
	ContextBlock,
	ContextCategory,
	ToolSchemaBlock,
	ToolSequence,
} from './types';

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function normalizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
	if (value === undefined) return '[undefined]';
	if (typeof value === 'bigint') return `${value.toString()}n`;
	if (typeof value === 'function') return `[function:${value.name || 'anonymous'}]`;
	if (value instanceof Date) return value.toISOString();
	if (!value || typeof value !== 'object') return value;
	if (seen.has(value)) return '[circular]';
	seen.add(value);
	if (Array.isArray(value)) return value.map((entry) => normalizeValue(entry, seen));
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, normalizeValue(entry, seen)]),
	);
}

export function stableSerialize(value: unknown): string {
	return JSON.stringify(normalizeValue(value));
}

export function contextHash(value: unknown): string {
	return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

function contentText(value: unknown): string {
	if (typeof value === 'string') return value;
	if (value === undefined || value === null) return '';
	return stableSerialize(value);
}

function makeBlock(
	category: ContextCategory,
	order: number,
	content: unknown,
	metadata?: Record<string, unknown>,
): ContextBlock {
	const hash = contextHash(content);
	return {
		id: `${category}:${order}:${hash.slice(0, 12)}`,
		category,
		order,
		content,
		text: contentText(content),
		hash,
		...policyForCategory(category),
		...(metadata ? { metadata } : {}),
	};
}

function messageRole(message: Record<string, unknown>): string {
	const getter = message._getType;
	const raw =
		(typeof getter === 'function' ? String(getter.call(message)) : '') ||
		String(message.role ?? message.type ?? '');
	if (raw === 'human') return 'user';
	if (raw === 'ai') return 'assistant';
	if (raw === 'function') return 'tool';
	return raw;
}

function toolCalls(message: Record<string, unknown>): unknown[] {
	const additional = asRecord(message.additional_kwargs) ?? asRecord(message.additionalKwargs);
	const direct = message.tool_calls ?? additional?.tool_calls ?? additional?.toolCalls;
	const calls = Array.isArray(direct) ? direct : direct ? [direct] : [];
	const contentCalls = Array.isArray(message.content)
		? message.content.filter((entry) => {
				const block = asRecord(entry);
				return block?.type === 'tool_use' || block?.type === 'function_call';
			})
		: [];
	return [...calls, ...contentCalls];
}

function callId(value: unknown, index: number): string {
	const call = asRecord(value);
	return String(call?.id ?? call?.tool_call_id ?? call?.name ?? `tool-call-${index}`);
}

function resultId(message: Record<string, unknown>): string | undefined {
	if (message.tool_call_id !== undefined) return String(message.tool_call_id);
	if (!Array.isArray(message.content)) return undefined;
	for (const entry of message.content) {
		const block = asRecord(entry);
		if (block?.type === 'tool_result' || block?.type === 'function_response') {
			return String(block.tool_use_id ?? block.tool_call_id ?? block.name ?? '');
		}
	}
	return undefined;
}

function buildToolSequences(history: unknown[]): ToolSequence[] {
	const sequences: ToolSequence[] = [];
	let pending:
		| {
				callIds: string[];
				unresolvedCallIds: string[];
				indexes: number[];
				parts: unknown[];
				issue?: string;
		  }
		| undefined;

	for (const [index, raw] of history.entries()) {
		const message = asRecord(raw) ?? {};
		const calls = toolCalls(message);
		const role = messageRole(message);
		const toolResultId = resultId(message);
		const isResult = role === 'tool' || toolResultId !== undefined;
		if (calls.length > 0) {
			if (pending) {
				pending.issue = 'new_call_before_previous_completed';
				sequences.push(finalizeSequence(pending, 'invalid'));
			}
			const ids = calls.map(callId);
			pending = {
				callIds: ids,
				unresolvedCallIds: [...ids],
				indexes: [index],
				parts: [raw],
			};
			continue;
		}
		if (!isResult) continue;
		if (!pending) {
			sequences.push(
				finalizeSequence(
					{
						callIds: toolResultId ? [toolResultId] : [],
						unresolvedCallIds: toolResultId ? [toolResultId] : [],
						indexes: [index],
						parts: [raw],
						issue: 'orphan_tool_result',
					},
					'invalid',
				),
			);
			continue;
		}
		pending.indexes.push(index);
		pending.parts.push(raw);
		const resolved = toolResultId || pending.unresolvedCallIds[0];
		if (resolved) {
			pending.unresolvedCallIds = pending.unresolvedCallIds.filter((id) => id !== resolved);
		}
		if (pending.unresolvedCallIds.length === 0) {
			sequences.push(finalizeSequence(pending, 'recent_completed'));
			pending = undefined;
		}
	}
	if (pending) sequences.push(finalizeSequence(pending, 'active'));
	return sequences;
}

function finalizeSequence(
	value: {
		callIds: string[];
		unresolvedCallIds: string[];
		indexes: number[];
		parts: unknown[];
		issue?: string;
	},
	status: ToolSequence['status'],
): ToolSequence {
	const hash = contextHash(value.parts);
	return {
		id: `tool-sequence:${hash.slice(0, 12)}`,
		callIds: value.callIds,
		messageIndexes: value.indexes,
		status,
		hash,
		...(value.issue ? { issue: value.issue } : {}),
	};
}

function appendValue(
	blocks: ContextBlock[],
	category: ContextCategory,
	value: unknown,
	metadata?: Record<string, unknown>,
): void {
	if (value === undefined || value === null || value === '') return;
	blocks.push(makeBlock(category, blocks.length, value, metadata));
}

export function canonicalizeContext(input: CanonicalContextInput): CanonicalContext {
	const blocks: ContextBlock[] = [];
	appendValue(blocks, 'system_instructions', input.systemPrompt);

	const history = Array.isArray(input.conversationHistory)
		? input.conversationHistory
		: input.conversationHistory === undefined || input.conversationHistory === null
			? []
			: [input.conversationHistory];
	const recentStart = Math.max(0, history.length - 8);
	for (const [index, value] of history.entries()) {
		const message = asRecord(value) ?? {};
		const calls = toolCalls(message);
		const role = messageRole(message);
		const category: ContextCategory =
			calls.length > 0
				? 'tool_call'
				: role === 'tool' || resultId(message) !== undefined
					? 'tool_result'
					: index >= recentStart
						? 'recent_history'
						: 'old_history';
		appendValue(blocks, category, value, { messageIndex: index, role });
	}

	appendValue(blocks, 'retrieved_context', input.retrievedContext);
	const tools = Array.isArray(input.toolDefinitions)
		? input.toolDefinitions
		: input.toolDefinitions === undefined || input.toolDefinitions === null
			? []
			: [input.toolDefinitions];
	for (const tool of tools) {
		const record = asRecord(tool);
		const block = makeBlock('tool_schema', blocks.length, tool, {
			toolName: String(record?.name ?? record?.function ?? 'unnamed_tool'),
		}) as ToolSchemaBlock;
		block.toolName = String(record?.name ?? asRecord(record?.function)?.name ?? 'unnamed_tool');
		blocks.push(block);
	}
	appendValue(blocks, 'external_data', input.externalData);
	appendValue(blocks, 'current_message', input.currentMessage);

	const toolSequences = buildToolSequences(history);
	return {
		version: 1,
		blocks,
		toolSequences,
		hash: contextHash({
			version: 1,
			blocks: blocks.map((block) => {
				const hashable = { ...block } as Partial<ContextBlock>;
				delete hashable.id;
				return hashable;
			}),
			toolSequences,
		}),
	};
}
