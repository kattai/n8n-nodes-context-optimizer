export interface MessageLike {
	content?: unknown;
	role?: string;
	type?: string;
	name?: string;
	tool_calls?: unknown;
	tool_call_id?: unknown;
	additional_kwargs?: unknown;
	additionalKwargs?: unknown;
	_getType?: () => string;
}

export type ToolSequenceIssue =
	| 'assistant_tool_call_without_user_or_tool_before'
	| 'orphan_tool_result'
	| 'tool_result_not_immediate'
	| 'tool_result_missing';

export interface ToolSequenceAnalysis {
	hasToolData: boolean;
	valid: boolean;
	issue?: ToolSequenceIssue;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function messageRole(message: MessageLike): string {
	const raw =
		(typeof message._getType === 'function' ? message._getType() : undefined) ??
		message.role ??
		message.type ??
		'';
	if (raw === 'human') return 'user';
	if (raw === 'ai') return 'assistant';
	if (raw === 'function') return 'tool';
	return raw;
}

function contentBlocks(message: MessageLike): Array<Record<string, unknown>> {
	if (!Array.isArray(message.content)) return [];
	return message.content
		.map((entry) => asRecord(entry))
		.filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function toolCalls(message: MessageLike): unknown[] {
	const additional =
		asRecord(message.additional_kwargs) ?? asRecord(message.additionalKwargs);
	const candidates = [
		message.tool_calls,
		additional?.tool_calls,
		additional?.toolCalls,
		...contentBlocks(message)
			.filter(
				(block) =>
					block.type === 'tool_use' ||
					block.type === 'function_call' ||
					block.functionCall !== undefined,
			)
			.map((block) => block.functionCall ?? block),
	];
	return candidates.flatMap((candidate) => (Array.isArray(candidate) ? candidate : candidate ? [candidate] : []));
}

function toolCallId(call: unknown, index: number): string {
	const record = asRecord(call);
	return String(record?.id ?? record?.tool_call_id ?? record?.name ?? `tool-call-${index}`);
}

function toolResultId(message: MessageLike): string | undefined {
	if (message.tool_call_id !== undefined) return String(message.tool_call_id);
	for (const block of contentBlocks(message)) {
		if (
			block.type === 'tool_result' ||
			block.type === 'function_response' ||
			block.functionResponse !== undefined
		) {
			const response = asRecord(block.functionResponse);
			return String(block.tool_use_id ?? block.tool_call_id ?? response?.name ?? '');
		}
	}
	return undefined;
}

export function messageHasToolData(message: MessageLike): boolean {
	const role = messageRole(message);
	return role === 'tool' || toolCalls(message).length > 0 || toolResultId(message) !== undefined;
}

export function analyzeToolSequence(messages: unknown[]): ToolSequenceAnalysis {
	let hasToolData = false;
	let previousRole = '';
	const pending = new Set<string>();

	for (const raw of messages) {
		const message = raw as MessageLike;
		const role = messageRole(message);
		const calls = toolCalls(message);
		const resultId = toolResultId(message);
		const isToolResult = role === 'tool' || resultId !== undefined;

		if (calls.length > 0 || isToolResult) hasToolData = true;

		if (pending.size > 0 && !isToolResult) {
			return { hasToolData: true, valid: false, issue: 'tool_result_not_immediate' };
		}

		if (isToolResult) {
			if (pending.size === 0) {
				return { hasToolData: true, valid: false, issue: 'orphan_tool_result' };
			}
			if (resultId && pending.has(resultId)) {
				pending.delete(resultId);
			} else {
				const firstPending = pending.values().next().value as string | undefined;
				if (firstPending) pending.delete(firstPending);
			}
			previousRole = 'tool';
			continue;
		}

		if (calls.length > 0) {
			if (previousRole !== 'user' && previousRole !== 'tool') {
				return {
					hasToolData: true,
					valid: false,
					issue: 'assistant_tool_call_without_user_or_tool_before',
				};
			}
			for (const [index, call] of calls.entries()) {
				pending.add(toolCallId(call, index));
			}
		}

		if (role) previousRole = role;
	}

	if (pending.size > 0) {
		return { hasToolData: true, valid: false, issue: 'tool_result_missing' };
	}

	return { hasToolData, valid: true };
}
