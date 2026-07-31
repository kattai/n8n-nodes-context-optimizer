import { canonicalProfileName } from '../core/profiles';
import type { OptimizerProfileName } from '../core/types';

export interface PreviewPolicy {
	thresholdTokens: number;
	maxPreviewTokens: number;
	maxItems: number;
	targetEligibleSavingsPercent: number;
}

export function resolvePreviewPolicy(
	profile: OptimizerProfileName,
	eligibleTokens: number,
): PreviewPolicy {
	const canonical = canonicalProfileName(profile);
	if (canonical === 'savings') {
		return {
			thresholdTokens: 1_000,
			maxPreviewTokens: Math.max(100, Math.floor(eligibleTokens * 0.2)),
			maxItems: 15,
			targetEligibleSavingsPercent: 80,
		};
	}
	if (canonical === 'balanced' || canonical === 'custom') {
		return {
			thresholdTokens: 2_000,
			maxPreviewTokens: Math.max(150, Math.floor(eligibleTokens * 0.55)),
			maxItems: 40,
			targetEligibleSavingsPercent: 45,
		};
	}
	return {
		thresholdTokens: Number.POSITIVE_INFINITY,
		maxPreviewTokens: eligibleTokens,
		maxItems: Number.MAX_SAFE_INTEGER,
		targetEligibleSavingsPercent: 0,
	};
}
