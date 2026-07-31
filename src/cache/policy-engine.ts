import type {
	CachePolicyAction,
	CachePolicyDecision,
	CachePolicyInput,
	CachePolicyReason,
} from './policy-types';
import { isSavingsProfile } from '../core/profiles';

function decision(
	action: CachePolicyAction,
	reason: CachePolicyReason,
	cacheCandidate: boolean,
	confidence: CachePolicyDecision['confidence'],
): CachePolicyDecision {
	return { action, reason, cacheCandidate, confidence };
}

function reductionAction(input: CachePolicyInput): CachePolicyAction {
	return isSavingsProfile(input.profile) && input.virtualizationReady ? 'virtualize' : 'optimize';
}

export function decideCacheAction(input: CachePolicyInput): CachePolicyDecision {
	if (input.mandatory) {
		return decision('preserve', 'mandatory_block', false, 'high');
	}
	if (!input.eligible) {
		return decision('preserve', 'ineligible_content', false, 'high');
	}

	if (input.strategy === 'ignore_cache_signals') {
		return decision(reductionAction(input), 'cache_signals_ignored', false, 'high');
	}
	if (input.strategy === 'token_reduction_priority') {
		return decision(reductionAction(input), 'reduction_priority', false, 'high');
	}

	const largeCommonPrefix =
		input.inCommonPrefix && input.commonPrefixTokens >= input.minimumStablePrefixTokens;
	const providerCacheEvidence =
		largeCommonPrefix &&
		input.volatility !== 'variable' &&
		(input.fingerprint?.lastProviderCachedTokens ?? 0) > 0;
	const repeatedStablePrefix =
		largeCommonPrefix &&
		input.volatility !== 'variable' &&
		(input.fingerprint?.seenCount ?? 0) >= input.minimumRepetitions;

	if (providerCacheEvidence) {
		return decision('preserve', 'provider_cache_evidence', true, 'high');
	}
	if (repeatedStablePrefix) {
		return decision('preserve', 'stable_repeated_prefix', true, 'high');
	}

	if (input.strategy === 'cache_priority') {
		if (largeCommonPrefix && input.volatility !== 'variable') {
			return decision('preserve', 'large_common_prefix', true, 'medium');
		}
		return decision(
			reductionAction(input),
			input.volatility === 'variable' ? 'variable_eligible_block' : 'cache_priority_not_eligible',
			false,
			'medium',
		);
	}

	if (input.volatility === 'variable') {
		return decision(reductionAction(input), 'variable_eligible_block', false, 'high');
	}
	return decision('preserve', 'uncertain_preserved', largeCommonPrefix, 'low');
}
