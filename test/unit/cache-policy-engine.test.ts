import { describe, expect, it } from 'vitest';
import { decideCacheAction } from '../../src/cache/policy-engine';
import type { CachePolicyInput } from '../../src/cache/policy-types';

function block(overrides: Partial<CachePolicyInput> = {}): CachePolicyInput {
	return {
		strategy: 'automatic_hybrid',
		profile: 'balanced',
		kind: 'old_history',
		estimatedTokens: 4_000,
		commonPrefixTokens: 4_000,
		inCommonPrefix: true,
		volatility: 'unknown',
		eligible: true,
		mandatory: false,
		virtualizationReady: false,
		minimumRepetitions: 2,
		minimumStablePrefixTokens: 2_048,
		...overrides,
	};
}

describe('cache policy engine', () => {
	it.each(['automatic_hybrid', 'cache_priority', 'token_reduction_priority', 'ignore_cache_signals'] as const)(
		'always preserves mandatory blocks in %s',
		(strategy) => {
			expect(decideCacheAction(block({ strategy, mandatory: true }))).toMatchObject({
				action: 'preserve',
				reason: 'mandatory_block',
			});
		},
	);

	it('preserves a repeated stable prefix in automatic hybrid mode', () => {
		const decision = decideCacheAction(
			block({
				volatility: 'stable',
				fingerprint: { seenCount: 2, lastProviderCachedTokens: 0 },
			}),
		);

		expect(decision).toEqual({
			action: 'preserve',
			reason: 'stable_repeated_prefix',
			cacheCandidate: true,
			confidence: 'high',
		});
	});

	it('uses provider cached tokens as strong evidence of a stable prefix', () => {
		const decision = decideCacheAction(
			block({ fingerprint: { seenCount: 1, lastProviderCachedTokens: 3_500 } }),
		);

		expect(decision.action).toBe('preserve');
		expect(decision.reason).toBe('provider_cache_evidence');
		expect(decision.cacheCandidate).toBe(true);
	});

	it('preserves uncertain blocks in automatic hybrid mode', () => {
		expect(decideCacheAction(block())).toMatchObject({
			action: 'preserve',
			reason: 'uncertain_preserved',
			confidence: 'low',
		});
	});

	it('optimizes clearly variable blocks in automatic hybrid mode', () => {
		expect(decideCacheAction(block({ volatility: 'variable' }))).toMatchObject({
			action: 'optimize',
			reason: 'variable_eligible_block',
		});
	});

	it('preserves a large common prefix in cache priority mode before repetitions exist', () => {
		expect(
			decideCacheAction(block({ strategy: 'cache_priority', volatility: 'unknown' })),
		).toMatchObject({
			action: 'preserve',
			reason: 'large_common_prefix',
			cacheCandidate: true,
		});
	});

	it('virtualizes eligible content in token reduction priority with maximum savings', () => {
		expect(
			decideCacheAction(
				block({
					strategy: 'token_reduction_priority',
					profile: 'aggressive',
					virtualizationReady: true,
				}),
			),
		).toMatchObject({
			action: 'virtualize',
			reason: 'reduction_priority',
		});
	});

	it('ignores all cache evidence in legacy mode', () => {
		expect(
			decideCacheAction(
				block({
					strategy: 'ignore_cache_signals',
					profile: 'aggressive',
					virtualizationReady: true,
					fingerprint: { seenCount: 100, lastProviderCachedTokens: 4_000 },
				}),
			),
		).toEqual({
			action: 'virtualize',
			reason: 'cache_signals_ignored',
			cacheCandidate: false,
			confidence: 'high',
		});
	});

	it('preserves ineligible content regardless of strategy', () => {
		expect(
			decideCacheAction(
				block({ strategy: 'token_reduction_priority', eligible: false }),
			),
		).toMatchObject({ action: 'preserve', reason: 'ineligible_content' });
	});
});
