import { canonicalProfileName } from '../core/profiles';
import type { OptimizerProfileName, PublicOptimizerProfileName } from '../core/types';

export type AdaptiveRiskSignal =
	| 'active_tool_sequence'
	| 'code_or_query'
	| 'exact_quote_requested'
	| 'forced_tool'
	| 'low_tool_confidence'
	| 'retrieval_unavailable'
	| 'structured_output'
	| 'unknown_message_shape';

export interface AdaptiveProfileResult {
	selectedProfile: PublicOptimizerProfileName;
	effectiveProfile: PublicOptimizerProfileName;
	riskLevel: 'low' | 'medium' | 'high';
	signals: AdaptiveRiskSignal[];
	downgraded: boolean;
}

const rank: Record<Exclude<PublicOptimizerProfileName, 'custom'>, number> = {
	quality: 0,
	balanced: 1,
	savings: 2,
};

function mostConservative(
	selected: Exclude<PublicOptimizerProfileName, 'custom'>,
	maximum: Exclude<PublicOptimizerProfileName, 'custom'>,
): Exclude<PublicOptimizerProfileName, 'custom'> {
	return rank[selected] <= rank[maximum] ? selected : maximum;
}

export function resolveAdaptiveProfile(
	profile: OptimizerProfileName,
	signals: Iterable<AdaptiveRiskSignal>,
): AdaptiveProfileResult {
	const selectedProfile = canonicalProfileName(profile);
	const uniqueSignals = [...new Set(signals)];
	const highRisk = uniqueSignals.some((signal) =>
		[
			'active_tool_sequence',
			'code_or_query',
			'exact_quote_requested',
			'forced_tool',
			'structured_output',
			'unknown_message_shape',
		].includes(signal),
	);
	const mediumRisk = uniqueSignals.some((signal) =>
		['low_tool_confidence', 'retrieval_unavailable'].includes(signal),
	);
	const riskLevel = highRisk ? 'high' : mediumRisk ? 'medium' : 'low';

	if (selectedProfile === 'custom') {
		return {
			selectedProfile,
			effectiveProfile: selectedProfile,
			riskLevel,
			signals: uniqueSignals,
			downgraded: false,
		};
	}

	const maximum = highRisk ? 'quality' : mediumRisk ? 'balanced' : 'savings';
	const effectiveProfile = mostConservative(selectedProfile, maximum);
	return {
		selectedProfile,
		effectiveProfile,
		riskLevel,
		signals: uniqueSignals,
		downgraded: effectiveProfile !== selectedProfile,
	};
}
