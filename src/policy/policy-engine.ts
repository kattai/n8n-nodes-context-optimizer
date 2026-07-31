import type { CanonicalContext, ContextBlock, ContextCategory } from '../context/types';
import { estimateTokens } from '../core/token-estimator';
import { resolveProfile } from '../core/profiles';
import type { CustomProfileConfig, OptimizerProfileName } from '../core/types';

export type ContextPolicyAction = 'preserve' | 'optimize' | 'virtualize';
export type ContextPolicyReason =
	| 'protected_block'
	| 'required_inline'
	| 'quality_structural_only'
	| 'recoverable_block'
	| 'retrieval_unavailable'
	| 'below_virtualization_threshold';

export interface ContextPolicyDecision {
	blockId: string;
	category: ContextCategory;
	action: ContextPolicyAction;
	reason: ContextPolicyReason;
	estimatedTokens: number;
	budgetTokens: number;
}

export interface ContextPolicyOptions {
	profile?: OptimizerProfileName;
	custom?: CustomProfileConfig;
	totalBudgetTokens?: number;
	categoryBudgets?: Partial<Record<ContextCategory, number>>;
	retrievalAvailable?: boolean;
	virtualizationThresholdTokens?: number;
}

export interface ContextPolicyResult {
	profile: string;
	canonicalProfile: string;
	targetEligibleSavingsPercent: { min: number; max: number };
	minimumNetSavingsTokens: number;
	totalBudgetTokens: number;
	decisions: ContextPolicyDecision[];
	status: 'ready' | 'retrieval_recommended' | 'protected_context_exceeds_budget';
}

const defaultCategoryWeights: Record<ContextCategory, number> = {
	system_instructions: 0.2,
	current_message: 0.15,
	recent_history: 0.2,
	old_history: 0.08,
	retrieved_context: 0.12,
	tool_schema: 0.1,
	tool_call: 0.04,
	tool_result: 0.06,
	external_data: 0.05,
};

function categoryBudget(
	category: ContextCategory,
	total: number,
	overrides: Partial<Record<ContextCategory, number>>,
): number {
	return Math.max(0, overrides[category] ?? Math.floor(total * defaultCategoryWeights[category]));
}

function decideBlock(
	block: ContextBlock,
	profile: ReturnType<typeof resolveProfile>,
	options: Required<
		Pick<ContextPolicyOptions, 'retrievalAvailable' | 'virtualizationThresholdTokens'>
	>,
): Pick<ContextPolicyDecision, 'action' | 'reason'> {
	if (block.protected) return { action: 'preserve', reason: 'protected_block' };
	if (block.recoverability === 'required_inline') {
		return { action: 'preserve', reason: 'required_inline' };
	}
	if (profile.canonicalName === 'quality') {
		return { action: 'optimize', reason: 'quality_structural_only' };
	}
	if (!options.retrievalAvailable) {
		return { action: 'optimize', reason: 'retrieval_unavailable' };
	}
	if (estimateTokens(block.text) < options.virtualizationThresholdTokens) {
		return { action: 'optimize', reason: 'below_virtualization_threshold' };
	}
	return { action: 'virtualize', reason: 'recoverable_block' };
}

export function decideContextPolicy(
	context: CanonicalContext,
	options: ContextPolicyOptions = {},
): ContextPolicyResult {
	const profile = resolveProfile(options.profile ?? 'balanced', options.custom);
	const totalBudgetTokens = Math.max(1, options.totalBudgetTokens ?? profile.maxInputTokens);
	const categoryBudgets = options.categoryBudgets ?? {};
	const policyOptions = {
		retrievalAvailable: options.retrievalAvailable ?? false,
		virtualizationThresholdTokens: Math.max(1, options.virtualizationThresholdTokens ?? 512),
	};
	const decisions = context.blocks.map((block) => {
		const selected = decideBlock(block, profile, policyOptions);
		return {
			blockId: block.id,
			category: block.category,
			...selected,
			estimatedTokens: estimateTokens(block.text),
			budgetTokens: categoryBudget(block.category, totalBudgetTokens, categoryBudgets),
		};
	});
	const protectedTokens = decisions
		.filter((decision) => decision.action === 'preserve')
		.reduce((total, decision) => total + decision.estimatedTokens, 0);
	const retrievalRecommended = decisions.some(
		(decision) => decision.reason === 'retrieval_unavailable' && decision.estimatedTokens > 512,
	);
	return {
		profile: profile.name,
		canonicalProfile: profile.canonicalName,
		targetEligibleSavingsPercent: {
			min: profile.eligibleSavingsMinPercent,
			max: profile.eligibleSavingsMaxPercent,
		},
		minimumNetSavingsTokens: profile.minimumNetSavingsTokens,
		totalBudgetTokens,
		decisions,
		status:
			protectedTokens > totalBudgetTokens
				? 'protected_context_exceeds_budget'
				: retrievalRecommended
					? 'retrieval_recommended'
					: 'ready',
	};
}
