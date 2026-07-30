import { describe, expect, it } from 'vitest';
import {
	aggregateMeasurements,
	analyzeTokens,
	compareRuns,
	normalizeMeasurement,
} from '../../src/analytics/token-analytics';

describe('token analytics', () => {
	it('calculates gross and net savings without hiding overhead', () => {
		const result = analyzeTokens({
			original: 10_000,
			sent: 5_000,
			compressor: 400,
			retrieved: 600,
			verifier: 200,
		});
		expect(result.savings.grossTokens).toBe(5_000);
		expect(result.savings.netTokens).toBe(3_800);
		expect(result.savings.netPercent).toBe(38);
		expect(result.savings.positive).toBe(true);
	});

	it('normalizes metrics emitted by Context Optimizer', () => {
		const result = normalizeMeasurement({
			optimization: {
				tokensBefore: 2_000,
				tokensAfter: 1_200,
				durationMs: 18,
				profile: 'balanced',
				fallback: true,
			},
		});
		expect(result.original).toBe(2_000);
		expect(result.sent).toBe(1_200);
		expect(result.latencyMs).toBe(18);
		expect(result.fallbacks).toBe(1);
		expect(result.profile).toBe('balanced');
	});

	it('normalizes content optimizer token fields', () => {
		const result = normalizeMeasurement({
			contentOptimization: {
				tokens: { original: 9_000, optimized: 1_500 },
				strategies: ['json-table', 'context-virtualization'],
			},
		});
		expect(result.original).toBe(9_000);
		expect(result.sent).toBe(1_500);
		expect(result.strategies).toEqual(['json-table', 'context-virtualization']);
	});

	it('normalizes the simple Token Saver Content output', () => {
		const result = analyzeTokens({
			tokenSavings: {
				before: 10_485,
				after: 5_935,
				saved: 4_550,
				percent: 43.4,
				measurement: 'estimated',
				qualityPassed: true,
			},
		});

		expect(result.measurement.original).toBe(10_485);
		expect(result.measurement.sent).toBe(5_935);
		expect(result.savings.grossTokens).toBe(4_550);
		expect(result.savings.grossPercent).toBe(43.4);
	});

	it('estimates cached and non-cached provider cost separately', () => {
		const result = analyzeTokens(
			{ original: 1_000_000, sent: 500_000, cached: 200_000, output: 100_000 },
			{
				inputPerMillion: 1,
				cachedInputPerMillion: 0.1,
				outputPerMillion: 2,
				currency: 'USD',
			},
		);
		expect(result.cost?.before).toBe(1.2);
		expect(result.cost?.after).toBe(0.52);
		expect(result.cost?.saved).toBe(0.68);
	});

	it('aggregates a batch and compares runs', () => {
		const aggregate = aggregateMeasurements([
			{ original: 100, sent: 60, strategies: ['json-table'] },
			{ original: 200, sent: 100, strategies: ['deduplicate'] },
		]);
		expect(aggregate.measurement.original).toBe(300);
		expect(aggregate.measurement.sent).toBe(160);
		expect(aggregate.measurement.strategies).toEqual(['json-table', 'deduplicate']);

		const comparison = compareRuns(
			{ original: 300, sent: 300, latencyMs: 100 },
			{ original: 300, sent: 160, latencyMs: 120 },
		);
		expect(comparison.delta.inputTokens).toBe(-140);
		expect(comparison.delta.latencyMs).toBe(20);
	});

	it('separates provider-reported tokens from optimizer estimates', () => {
		const result = analyzeTokens({
			optimization: { tokensBefore: 12_000, tokensAfter: 400 },
			providerUsage: {
				inputTokens: 391,
				outputTokens: 28,
				reasoningTokens: 101,
				totalTokens: 520,
				available: true,
			},
		});

		expect(result.measurement.sent).toBe(400);
		expect(result.actual).toEqual({
			available: true,
			inputTokens: 391,
			outputTokens: 28,
			reasoningTokens: 101,
			totalTokens: 520,
			billableOutputTokens: 129,
		});
	});

	it('compares A/B input tokens using provider usage when both runs expose it', () => {
		const result = compareRuns(
			{ providerUsage: { inputTokens: 12_339, outputTokens: 28, available: true } },
			{ providerUsage: { inputTokens: 391, outputTokens: 28, available: true } },
		);

		expect(result.delta.inputTokens).toBe(-11_948);
		expect(result.delta.inputTokenBasis).toBe('provider-actual');
	});
});
