import type { ProviderUsageTelemetry } from './model-telemetry-registry';

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function numeric(record: Record<string, unknown>, names: string[]): number | undefined {
	for (const name of names) {
		const value = record[name];
		if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
	}
	return undefined;
}

function candidates(root: Record<string, unknown>): Record<string, unknown>[] {
	const responseMetadata = asRecord(root.response_metadata ?? root.responseMetadata);
	const llmOutput = asRecord(root.llmOutput);
	return [
		asRecord(root.usage_metadata ?? root.usageMetadata ?? root.usage),
		asRecord(
			responseMetadata?.usage_metadata ??
				responseMetadata?.usageMetadata ??
				responseMetadata?.usage,
		),
		asRecord(llmOutput?.tokenUsage ?? llmOutput?.usage),
	].filter((value): value is Record<string, unknown> => Boolean(value));
}

function fromUsage(usage: Record<string, unknown>): ProviderUsageTelemetry | undefined {
	const inputDetails = asRecord(
		usage.input_token_details ?? usage.inputTokenDetails ?? usage.promptTokensDetails,
	);
	const outputDetails = asRecord(
		usage.output_token_details ?? usage.outputTokenDetails ?? usage.completionTokensDetails,
	);
	const inputTokens = numeric(usage, [
		'input_tokens',
		'inputTokens',
		'prompt_tokens',
		'promptTokens',
		'promptTokenCount',
		'prompt_eval_count',
	]);
	const outputTokens = numeric(usage, [
		'output_tokens',
		'outputTokens',
		'completion_tokens',
		'completionTokens',
		'candidatesTokenCount',
		'eval_count',
	]);
	const explicitTotal = numeric(usage, ['total_tokens', 'totalTokens', 'totalTokenCount']);
	const totalTokens =
		explicitTotal ??
		(inputTokens !== undefined && outputTokens !== undefined
			? inputTokens + outputTokens
			: undefined);
	const cachedInputTokens =
		numeric(usage, [
			'cached_tokens',
			'cachedTokens',
			'cachedContentTokenCount',
			'cacheReadInputTokens',
		]) ??
		(inputDetails
			? numeric(inputDetails, ['cache_read', 'cacheRead', 'cached_tokens'])
			: undefined);
	const reasoningTokens =
		numeric(usage, ['thoughtsTokenCount', 'reasoningTokens']) ??
		(outputDetails
			? numeric(outputDetails, ['reasoning', 'reasoning_tokens'])
			: undefined);
	if (
		inputTokens === undefined &&
		outputTokens === undefined &&
		totalTokens === undefined &&
		cachedInputTokens === undefined &&
		reasoningTokens === undefined
	) {
		return undefined;
	}
	return {
		inputTokens,
		outputTokens,
		totalTokens,
		cachedInputTokens,
		reasoningTokens,
		available: true,
	};
}

function visit(
	value: unknown,
	seen: WeakSet<object>,
	depth: number,
): ProviderUsageTelemetry | undefined {
	if (depth > 6 || value === null || value === undefined) return undefined;
	if (Array.isArray(value)) {
		for (const entry of [...value].reverse()) {
			const found = visit(entry, seen, depth + 1);
			if (found) return found;
		}
		return undefined;
	}
	const root = asRecord(value);
	if (!root || seen.has(root)) return undefined;
	seen.add(root);
	for (const usage of candidates(root)) {
		const found = fromUsage(usage);
		if (found) return found;
	}
	for (const key of [
		'generations',
		'message',
		'messages',
		'result',
		'results',
		'response',
		'output',
	]) {
		const found = visit(root[key], seen, depth + 1);
		if (found) return found;
	}
	return undefined;
}

export function extractProviderUsage(response: unknown): ProviderUsageTelemetry {
	return visit(response, new WeakSet(), 0) ?? { available: false };
}
