export interface MessageLike {
	content?: unknown;
	role?: string;
	type?: string;
	name?: string;
	tool_calls?: unknown;
	toolCalls?: unknown;
	tool_call_id?: unknown;
	toolCallId?: unknown;
	additional_kwargs?: unknown;
	additionalKwargs?: unknown;
	_getType?: () => string;
}

export type ToolSequenceIssue =
	| 'assistant_tool_call_without_user_or_tool_before'
	| 'orphan_tool_result'
	| 'tool_result_not_immediate'
	| 'tool_result_missing'
	| 'tool_result_id_mismatch'
	| 'parallel_tool_result_missing_id';

export type ToolSequenceStatus = 'active' | 'recent_completed' | 'archived_completed' | 'invalid';

export interface ToolSequenceGroup {
	status: ToolSequenceStatus;
	callIds: string[];
	unresolvedCallIds: string[];
	callMessageIndexes: number[];
	resultMessageIndexes: number[];
	messageIndexes: number[];
	anchorMessageIndex?: number;
	issue?: ToolSequenceIssue;
}

export interface ToolSequenceAnalysis {
	hasToolData: boolean;
	valid: boolean;
	groups: ToolSequenceGroup[];
	activeMessageIndexes: number[];
	completedResultIndexes: number[];
	structuralMessageIndexes: number[];
	issue?: ToolSequenceIssue;
}

export function asMessageRecord(value: unknown): Record<string, unknown> | undefined {
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

export function contentBlocks(message: MessageLike): Array<Record<string, unknown>> {
	if (!Array.isArray(message.content)) return [];
	return message.content
		.map((entry) => asMessageRecord(entry))
		.filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

export function messageToolCalls(message: MessageLike): unknown[] {
	const additional =
		asMessageRecord(message.additional_kwargs) ?? asMessageRecord(message.additionalKwargs);
	const candidates = [
		message.tool_calls,
		message.toolCalls,
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
	return candidates.flatMap((candidate) =>
		Array.isArray(candidate) ? candidate : candidate ? [candidate] : [],
	);
}

export function messageToolCallId(call: unknown, index: number): string {
	const record = asMessageRecord(call);
	const functionRecord = asMessageRecord(record?.function);
	return String(
		record?.id ??
			record?.tool_call_id ??
			record?.toolCallId ??
			record?.name ??
			functionRecord?.name ??
			`tool-call-${index}`,
	);
}

export function messageToolResultId(message: MessageLike): string | undefined {
	if (message.tool_call_id !== undefined) return String(message.tool_call_id);
	if (message.toolCallId !== undefined) return String(message.toolCallId);
	for (const block of contentBlocks(message)) {
		if (
			block.type === 'tool_result' ||
			block.type === 'function_response' ||
			block.functionResponse !== undefined
		) {
			const response = asMessageRecord(block.functionResponse);
			const id =
				block.tool_use_id ??
				block.tool_call_id ??
				block.toolCallId ??
				response?.id ??
				response?.tool_call_id ??
				response?.name;
			return id === undefined || id === '' ? undefined : String(id);
		}
	}
	return undefined;
}

export function messageHasToolData(message: MessageLike): boolean {
	const role = messageRole(message);
	return (
		role === 'tool' ||
		messageToolCalls(message).length > 0 ||
		messageToolResultId(message) !== undefined
	);
}

function invalidGroup(
	groups: ToolSequenceGroup[],
	issue: ToolSequenceIssue,
	index: number,
	callIds: string[] = [],
): ToolSequenceAnalysis {
	const invalid: ToolSequenceGroup = {
		status: 'invalid',
		callIds,
		unresolvedCallIds: callIds,
		callMessageIndexes: [],
		resultMessageIndexes: [],
		messageIndexes: [index],
		issue,
	};
	const allGroups = [...groups, invalid];
	return buildAnalysis(allGroups, issue);
}

function buildAnalysis(
	groups: ToolSequenceGroup[],
	issue?: ToolSequenceIssue,
): ToolSequenceAnalysis {
	return {
		hasToolData: groups.length > 0,
		valid: !issue && groups.every((group) => group.status !== 'invalid'),
		groups,
		activeMessageIndexes: groups
			.filter((group) => group.status === 'active')
			.flatMap((group) => group.messageIndexes),
		completedResultIndexes: groups
			.filter(
				(group) => group.status === 'recent_completed' || group.status === 'archived_completed',
			)
			.flatMap((group) => group.resultMessageIndexes),
		structuralMessageIndexes: groups.flatMap((group) => [
			...group.messageIndexes,
			...(group.anchorMessageIndex === undefined ? [] : [group.anchorMessageIndex]),
		]),
		...(issue ? { issue } : {}),
	};
}

export function analyzeToolSequence(
	messages: unknown[],
	recentMessageCount = 8,
): ToolSequenceAnalysis {
	const groups: ToolSequenceGroup[] = [];
	let pending: ToolSequenceGroup | undefined;
	let previousRole = '';
	let previousNonSystemIndex: number | undefined;
	const recentStart = Math.max(0, messages.length - recentMessageCount);

	for (const [index, raw] of messages.entries()) {
		const message = (asMessageRecord(raw) ?? {}) as MessageLike;
		const role = messageRole(message);
		const calls = messageToolCalls(message);
		const resultId = messageToolResultId(message);
		const isToolResult = role === 'tool' || resultId !== undefined;

		if (pending && !isToolResult) {
			pending.status = 'invalid';
			pending.issue = 'tool_result_not_immediate';
			groups.push(pending);
			return buildAnalysis(groups, pending.issue);
		}

		if (isToolResult) {
			if (!pending) return invalidGroup(groups, 'orphan_tool_result', index);
			let resolvedId = resultId;
			if (!resolvedId) {
				if (pending.unresolvedCallIds.length !== 1) {
					pending.status = 'invalid';
					pending.issue = 'parallel_tool_result_missing_id';
					pending.resultMessageIndexes.push(index);
					pending.messageIndexes.push(index);
					groups.push(pending);
					return buildAnalysis(groups, pending.issue);
				}
				resolvedId = pending.unresolvedCallIds[0];
			}
			if (!pending.unresolvedCallIds.includes(resolvedId)) {
				pending.status = 'invalid';
				pending.issue = 'tool_result_id_mismatch';
				pending.resultMessageIndexes.push(index);
				pending.messageIndexes.push(index);
				groups.push(pending);
				return buildAnalysis(groups, pending.issue);
			}
			pending.unresolvedCallIds = pending.unresolvedCallIds.filter(
				(callId) => callId !== resolvedId,
			);
			pending.resultMessageIndexes.push(index);
			pending.messageIndexes.push(index);
			previousRole = 'tool';
			previousNonSystemIndex = index;
			if (pending.unresolvedCallIds.length === 0) {
				pending.status = index >= recentStart ? 'recent_completed' : 'archived_completed';
				groups.push(pending);
				pending = undefined;
			}
			continue;
		}

		if (calls.length > 0) {
			if (previousRole !== 'user' && previousRole !== 'tool') {
				return invalidGroup(
					groups,
					'assistant_tool_call_without_user_or_tool_before',
					index,
					calls.map(messageToolCallId),
				);
			}
			const callIds = calls.map(messageToolCallId);
			pending = {
				status: 'active',
				callIds,
				unresolvedCallIds: [...callIds],
				callMessageIndexes: [index],
				resultMessageIndexes: [],
				messageIndexes: [index],
				...(previousRole === 'user' && previousNonSystemIndex !== undefined
					? { anchorMessageIndex: previousNonSystemIndex }
					: {}),
			};
			previousRole = 'assistant';
			previousNonSystemIndex = index;
			continue;
		}

		if (role) previousRole = role;
		if (role && role !== 'system') previousNonSystemIndex = index;
	}

	if (pending) groups.push(pending);
	return buildAnalysis(groups);
}
