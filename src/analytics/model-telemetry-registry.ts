import type { ModelOptimizationMetrics } from '../model-wrapper/wrap-language-model';

export interface ProviderUsageTelemetry {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	cachedInputTokens?: number;
	reasoningTokens?: number;
	available: boolean;
}

export interface ModelTelemetryRecord {
	executionId: string;
	nodeName: string;
	recordedAt: string;
	calls?: number;
	optimization: ModelOptimizationMetrics;
	providerUsage: ProviderUsageTelemetry;
}

const MAX_EXECUTIONS = 200;
const RECORD_TTL_MS = 24 * 60 * 60 * 1000;
const registry = new Map<string, Map<string, ModelTelemetryRecord>>();

function sumOptional(left?: number, right?: number): number | undefined {
	if (left === undefined && right === undefined) return undefined;
	return (left ?? 0) + (right ?? 0);
}

function percentage(before: number, after: number): number {
	if (before <= 0) return 0;
	return Number((((before - after) / before) * 100).toFixed(2));
}

function mergeCacheDecision(
	left: ModelOptimizationMetrics['cacheDecision'] | undefined,
	right: ModelOptimizationMetrics['cacheDecision'] | undefined,
): ModelOptimizationMetrics['cacheDecision'] {
	if (!left && !right) return 'legacy_profile_only';
	if (!left) return right ?? 'legacy_profile_only';
	if (!right) return left;
	if (left === 'hybrid' || right === 'hybrid') return 'hybrid';
	if (
		(left === 'preserve_stable_prefix' && right === 'reduce_dynamic_blocks') ||
		(left === 'reduce_dynamic_blocks' && right === 'preserve_stable_prefix')
	) {
		return 'hybrid';
	}
	if (right !== 'no_change') return right;
	return left;
}

function mergeRecords(
	previous: ModelTelemetryRecord,
	current: ModelTelemetryRecord,
): ModelTelemetryRecord {
	const before = previous.optimization.tokensBeforeEstimated + current.optimization.tokensBeforeEstimated;
	const after = previous.optimization.tokensAfterEstimated + current.optimization.tokensAfterEstimated;
	const eligibleBefore =
		previous.optimization.eligibleTokensBefore + current.optimization.eligibleTokensBefore;
	const eligibleAfter =
		previous.optimization.eligibleTokensAfter + current.optimization.eligibleTokensAfter;
	const targetBandReached = eligibleBefore > 0 && eligibleAfter / eligibleBefore <= 0.3;
	return {
		...current,
		calls: (previous.calls ?? 1) + (current.calls ?? 1),
		optimization: {
			...current.optimization,
			messagesBefore:
				previous.optimization.messagesBefore + current.optimization.messagesBefore,
			messagesAfter:
				previous.optimization.messagesAfter + current.optimization.messagesAfter,
			tokensBeforeEstimated: before,
			tokensAfterEstimated: after,
			savingsTokensEstimated: Math.max(0, before - after),
			savingsPercentEstimated: percentage(before, after),
			protectedFactsCount:
				previous.optimization.protectedFactsCount + current.optimization.protectedFactsCount,
			eligibleTokensBefore: eligibleBefore,
			eligibleTokensAfter: eligibleAfter,
			eligibleSavingsPercent: percentage(eligibleBefore, eligibleAfter),
			virtualizedResourceIds: [
				...new Set([
					...previous.optimization.virtualizedResourceIds,
					...current.optimization.virtualizedResourceIds,
				]),
			],
			retrievalRequired:
				previous.optimization.retrievalRequired || current.optimization.retrievalRequired,
			targetBandReached,
			targetNotReachedReason: targetBandReached
				? undefined
				: current.optimization.targetNotReachedReason ??
					previous.optimization.targetNotReachedReason,
			storageFallbackUsed:
				previous.optimization.storageFallbackUsed || current.optimization.storageFallbackUsed,
			cacheDecision: mergeCacheDecision(
				previous.optimization.cacheDecision,
				current.optimization.cacheDecision,
			),
			cacheRegistryScope:
				current.optimization.cacheRegistryScope ??
				previous.optimization.cacheRegistryScope ??
				'disabled',
			cacheWarning:
				current.optimization.cacheWarning ?? previous.optimization.cacheWarning,
			stablePrefixTokens:
				(previous.optimization.stablePrefixTokens ?? 0) +
				(current.optimization.stablePrefixTokens ?? 0),
			dynamicTokensBefore:
				(previous.optimization.dynamicTokensBefore ?? 0) +
				(current.optimization.dynamicTokensBefore ?? 0),
			dynamicTokensAfter:
				(previous.optimization.dynamicTokensAfter ?? 0) +
				(current.optimization.dynamicTokensAfter ?? 0),
			bypassReason:
				current.optimization.bypassReason ?? previous.optimization.bypassReason,
			selectedProfile:
				current.optimization.selectedProfile ?? previous.optimization.selectedProfile,
			effectiveProfile:
				current.optimization.effectiveProfile ?? previous.optimization.effectiveProfile,
			adaptiveRiskLevel:
				current.optimization.adaptiveRiskLevel ?? previous.optimization.adaptiveRiskLevel,
			adaptiveRiskSignals: [
				...new Set([
					...(previous.optimization.adaptiveRiskSignals ?? []),
					...(current.optimization.adaptiveRiskSignals ?? []),
				]),
			],
			adaptiveDowngrade:
				(previous.optimization.adaptiveDowngrade ?? false) ||
				(current.optimization.adaptiveDowngrade ?? false),
			promptTokensBefore:
				(previous.optimization.promptTokensBefore ?? 0) +
				(current.optimization.promptTokensBefore ?? 0),
			promptTokensAfter:
				(previous.optimization.promptTokensAfter ?? 0) +
				(current.optimization.promptTokensAfter ?? 0),
			promptSavedTokens:
				(previous.optimization.promptSavedTokens ?? 0) +
				(current.optimization.promptSavedTokens ?? 0),
		},
		providerUsage: {
			inputTokens: sumOptional(
				previous.providerUsage.inputTokens,
				current.providerUsage.inputTokens,
			),
			outputTokens: sumOptional(
				previous.providerUsage.outputTokens,
				current.providerUsage.outputTokens,
			),
			totalTokens: sumOptional(
				previous.providerUsage.totalTokens,
				current.providerUsage.totalTokens,
			),
			cachedInputTokens: sumOptional(
				previous.providerUsage.cachedInputTokens,
				current.providerUsage.cachedInputTokens,
			),
			reasoningTokens: sumOptional(
				previous.providerUsage.reasoningTokens,
				current.providerUsage.reasoningTokens,
			),
			available: previous.providerUsage.available || current.providerUsage.available,
		},
	};
}

function pruneRegistry(now = Date.now()): void {
	for (const [executionId, records] of registry) {
		for (const [nodeName, record] of records) {
			const recordedAt = Date.parse(record.recordedAt);
			if (!Number.isFinite(recordedAt) || now - recordedAt > RECORD_TTL_MS) {
				records.delete(nodeName);
			}
		}
		if (records.size === 0) registry.delete(executionId);
	}
	while (registry.size > MAX_EXECUTIONS) {
		const oldestExecutionId = registry.keys().next().value as string | undefined;
		if (!oldestExecutionId) return;
		registry.delete(oldestExecutionId);
	}
}

export function recordModelTelemetry(record: ModelTelemetryRecord): void {
	pruneRegistry();
	const executionRecords =
		registry.get(record.executionId) ?? new Map<string, ModelTelemetryRecord>();
	const previous = executionRecords.get(record.nodeName);
	executionRecords.set(record.nodeName, previous ? mergeRecords(previous, record) : record);
	registry.set(record.executionId, executionRecords);
	pruneRegistry();
}

export function getModelTelemetry(
	executionId: string,
	nodeName: string,
): ModelTelemetryRecord | undefined {
	pruneRegistry();
	return registry.get(executionId)?.get(nodeName);
}

export function getExecutionModelTelemetry(executionId: string): ModelTelemetryRecord[] {
	pruneRegistry();
	return [...(registry.get(executionId)?.values() ?? [])]
		.map((record) => ({ ...record, calls: record.calls ?? 1 }))
		.sort((left, right) => left.nodeName.localeCompare(right.nodeName));
}

export function clearExecutionTelemetry(executionId: string): void {
	registry.delete(executionId);
}

export function clearAllModelTelemetry(): void {
	registry.clear();
}
