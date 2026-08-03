import { beforeEach, describe, expect, it } from 'vitest';
import {
	clearAllModelTelemetry,
	clearExecutionTelemetry,
	getExecutionModelTelemetry,
	getModelTelemetry,
	recordModelTelemetry,
} from '../../src/analytics/model-telemetry-registry';

describe('model telemetry registry', () => {
	beforeEach(() => clearAllModelTelemetry());

	it('isolates model telemetry by execution and node name', () => {
		recordModelTelemetry({
			executionId: 'exec-1',
			nodeName: 'Measured Baseline',
			recordedAt: new Date().toISOString(),
			optimization: {
				operation: 'invoke',
				profile: 'measure_only',
				messagesBefore: 8,
				messagesAfter: 8,
				tokensBeforeEstimated: 100,
				tokensAfterEstimated: 100,
				savingsTokensEstimated: 0,
				savingsPercentEstimated: 0,
				protectedFactsCount: 0,
				tokensAreEstimated: true,
				eligibleTokensBefore: 0,
				eligibleTokensAfter: 0,
				eligibleSavingsPercent: 0,
				virtualizedResourceIds: [],
				retrievalRequired: false,
				targetBandReached: false,
				storageFallbackUsed: false,
			},
			providerUsage: {
				inputTokens: 120,
				outputTokens: 10,
				totalTokens: 130,
				available: true,
			},
		});

		expect(getModelTelemetry('exec-1', 'Measured Baseline')).toMatchObject({
			providerUsage: { inputTokens: 120 },
		});
		expect(getModelTelemetry('exec-2', 'Measured Baseline')).toBeUndefined();
		expect(getModelTelemetry('exec-1', 'Measured Baseline')).toMatchObject({
			providerUsage: { inputTokens: 120 },
		});

		clearExecutionTelemetry('exec-1');
		expect(getModelTelemetry('exec-1', 'Measured Baseline')).toBeUndefined();
	});

	it('aggregates every model call made by the same agent node', () => {
		const base = {
			executionId: 'exec-loop',
			nodeName: 'Maximum Savings',
			recordedAt: new Date().toISOString(),
		};
		recordModelTelemetry({
			...base,
			optimization: {
				operation: 'invoke',
				profile: 'aggressive',
				messagesBefore: 3,
				messagesAfter: 3,
				tokensBeforeEstimated: 10_000,
				tokensAfterEstimated: 2_000,
				savingsTokensEstimated: 8_000,
				savingsPercentEstimated: 80,
				protectedFactsCount: 4,
				tokensAreEstimated: true,
				eligibleTokensBefore: 9_000,
				eligibleTokensAfter: 1_800,
				eligibleSavingsPercent: 80,
				virtualizedResourceIds: ['ctx-1'],
				retrievalRequired: true,
				targetBandReached: true,
				storageFallbackUsed: false,
			},
			providerUsage: { inputTokens: 2_200, outputTokens: 100, totalTokens: 2_300, available: true },
		});
		recordModelTelemetry({
			...base,
			optimization: {
				operation: 'invoke',
				profile: 'aggressive',
				messagesBefore: 5,
				messagesAfter: 5,
				tokensBeforeEstimated: 3_000,
				tokensAfterEstimated: 2_500,
				savingsTokensEstimated: 500,
				savingsPercentEstimated: 16.67,
				protectedFactsCount: 2,
				tokensAreEstimated: true,
				eligibleTokensBefore: 0,
				eligibleTokensAfter: 0,
				eligibleSavingsPercent: 0,
				virtualizedResourceIds: [],
				retrievalRequired: false,
				targetBandReached: false,
				storageFallbackUsed: false,
			},
			providerUsage: { inputTokens: 2_700, outputTokens: 120, totalTokens: 2_820, available: true },
		});

		const aggregate = getModelTelemetry('exec-loop', 'Maximum Savings');
		expect(aggregate?.providerUsage).toMatchObject({
			inputTokens: 4_900,
			outputTokens: 220,
			totalTokens: 5_120,
			available: true,
		});
		expect(aggregate?.optimization).toMatchObject({
			tokensBeforeEstimated: 13_000,
			tokensAfterEstimated: 4_500,
			savingsTokensEstimated: 8_500,
			eligibleTokensBefore: 9_000,
			eligibleTokensAfter: 1_800,
			eligibleSavingsPercent: 80,
			virtualizedResourceIds: ['ctx-1'],
			retrievalRequired: true,
			targetBandReached: true,
		});
		expect(aggregate?.calls).toBe(2);
		expect(getExecutionModelTelemetry('exec-loop')).toHaveLength(1);
	});

	it('lists every optimized model in one execution without crossing executions', () => {
		const template = {
			recordedAt: new Date().toISOString(),
			optimization: {
				operation: 'invoke' as const,
				profile: 'balanced',
				messagesBefore: 1,
				messagesAfter: 1,
				tokensBeforeEstimated: 100,
				tokensAfterEstimated: 50,
				savingsTokensEstimated: 50,
				savingsPercentEstimated: 50,
				protectedFactsCount: 0,
				tokensAreEstimated: true as const,
				eligibleTokensBefore: 0,
				eligibleTokensAfter: 0,
				eligibleSavingsPercent: 0,
				virtualizedResourceIds: [],
				retrievalRequired: false,
				targetBandReached: false,
				storageFallbackUsed: false,
				cacheStrategy: 'ignore_cache_signals' as const,
				cacheDecision: 'legacy_profile_only' as const,
				stablePrefixTokens: 0,
				dynamicTokensBefore: 0,
				dynamicTokensAfter: 0,
				cacheRegistryScope: 'disabled' as const,
			},
			providerUsage: { available: false },
		};
		recordModelTelemetry({ ...template, executionId: 'one', nodeName: 'Agent B' });
		recordModelTelemetry({ ...template, executionId: 'one', nodeName: 'Agent A' });
		recordModelTelemetry({ ...template, executionId: 'two', nodeName: 'Agent C' });

		expect(getExecutionModelTelemetry('one').map((record) => record.nodeName)).toEqual([
			'Agent A',
			'Agent B',
		]);
		expect(getExecutionModelTelemetry('two')).toHaveLength(1);
	});
});
