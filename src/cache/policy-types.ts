import type { OptimizerProfileName } from '../core/types';

export type CacheStrategy =
	| 'automatic_hybrid'
	| 'cache_priority'
	| 'token_reduction_priority'
	| 'ignore_cache_signals';

export type CacheBlockKind =
	| 'system_prompt'
	| 'tool_schema'
	| 'current_message'
	| 'recent_history'
	| 'user_correction'
	| 'protected_content'
	| 'old_history'
	| 'tool_output'
	| 'external_data'
	| 'rag_context'
	| 'logs';

export type CacheBlockVolatility = 'stable' | 'variable' | 'unknown';

export interface CacheFingerprintEvidence {
	seenCount: number;
	lastProviderCachedTokens?: number;
}

export interface CachePolicyInput {
	strategy: CacheStrategy;
	profile: OptimizerProfileName;
	kind: CacheBlockKind;
	estimatedTokens: number;
	commonPrefixTokens: number;
	inCommonPrefix: boolean;
	volatility: CacheBlockVolatility;
	eligible: boolean;
	mandatory: boolean;
	virtualizationReady: boolean;
	minimumRepetitions: number;
	minimumStablePrefixTokens: number;
	fingerprint?: CacheFingerprintEvidence;
}

export type CachePolicyAction = 'preserve' | 'optimize' | 'virtualize';

export type CachePolicyReason =
	| 'mandatory_block'
	| 'ineligible_content'
	| 'provider_cache_evidence'
	| 'stable_repeated_prefix'
	| 'uncertain_preserved'
	| 'variable_eligible_block'
	| 'large_common_prefix'
	| 'cache_priority_not_eligible'
	| 'reduction_priority'
	| 'cache_signals_ignored';

export interface CachePolicyDecision {
	action: CachePolicyAction;
	reason: CachePolicyReason;
	cacheCandidate: boolean;
	confidence: 'high' | 'medium' | 'low';
}
