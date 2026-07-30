import { describe, expect, it } from 'vitest';
import {
	compactRetrievalResult,
	contentOutput,
	modelComparisonOutput,
	storeReceipt,
} from '../../src/output/format-node-output';

describe('simple node outputs', () => {
	it('returns optimized content without copying the original large input', () => {
		const original = 'large original '.repeat(1_000);
		const result = contentOutput(
			'optimizeContent',
			{
				optimizedContent: 'compact',
				contentType: 'text',
				strategies: ['deduplicate-exact'],
				tokens: {
					original: 4_000,
					optimized: 2,
					saved: 3_998,
					savingsPercent: 99.95,
					areEstimated: true,
				},
				quality: {
					passed: true,
					score: 1,
					checks: [],
					warnings: [],
					fallbackUsed: false,
				},
				manifest: {
					contentType: 'text',
					originalHash: 'hash',
					originalBytes: original.length,
					optimizedBytes: 7,
					format: 'text',
				},
			},
			{ applied: false },
			'simple',
		);

		expect(result).toMatchObject({
			optimizedContent: 'compact',
			tokenSavings: {
				before: 4_000,
				after: 2,
				saved: 3_998,
				measurement: 'estimated',
				qualityPassed: true,
			},
		});
		expect(JSON.stringify(result)).not.toContain(original);
		expect(result).not.toHaveProperty('contentOptimization');
	});

	it('compacts a store manifest to the receipt needed downstream', () => {
		const receipt = storeReceipt({
			storageVersion: 1,
			resourceId: 'ctx_1',
			contentType: 'json',
			originalHash: 'secret-hash',
			originalBytes: 10_000,
			originalTokens: 2_500,
			createdAt: '2026-07-30T00:00:00.000Z',
			expiresAt: '2026-07-31T00:00:00.000Z',
			scope: 'workflow-1',
			recordCount: 100,
			fields: ['id', 'status'],
		});

		expect(receipt).toEqual({
			stored: true,
			resourceId: 'ctx_1',
			contentType: 'json',
			expiresAt: '2026-07-31T00:00:00.000Z',
			recordCount: 100,
			fields: ['id', 'status'],
		});
	});

	it('returns only useful model-visible retrieval fields', () => {
		const compact = compactRetrievalResult({
			ok: true,
			operation: 'get_exact_value',
			resourceId: 'ctx_1',
			exact: true,
			path: '[0].total',
			data: 12850,
			redacted: false,
			truncated: false,
			tokensEstimated: 3,
		});

		expect(compact).toEqual({
			ok: true,
			data: 12850,
			source: { resourceId: 'ctx_1', path: '[0].total', exact: true },
			tokens: 3,
		});
	});

	it('summarizes a provider A/B comparison without nested diagnostics', () => {
		const output = modelComparisonOutput({
			baseline: {} as never,
			optimized: {} as never,
			delta: {
				inputTokens: -2_080,
				netTokens: 0,
				latencyMs: 12,
				fallbacks: 0,
				qualityGuardFailures: 0,
				inputTokenBasis: 'provider-actual',
			},
		}, 3_120, 1_040);

		expect(output).toEqual({
			tokenSavings: {
				before: 3_120,
				after: 1_040,
				saved: 2_080,
				percent: 66.67,
				measurement: 'provider',
				qualityPassed: true,
			},
		});
	});
});
