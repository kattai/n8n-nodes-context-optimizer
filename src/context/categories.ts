import type {
	ContextCategory,
	ContextExactness,
	ContextRecoverability,
	ContextRisk,
	ContextStability,
} from './types';

export interface CategoryPolicy {
	risk: ContextRisk;
	stability: ContextStability;
	exactness: ContextExactness;
	recoverability: ContextRecoverability;
	protected: boolean;
}

const categoryPolicies: Record<ContextCategory, CategoryPolicy> = {
	system_instructions: {
		risk: 'critical',
		stability: 'stable',
		exactness: 'byte_exact',
		recoverability: 'required_inline',
		protected: true,
	},
	current_message: {
		risk: 'critical',
		stability: 'volatile',
		exactness: 'byte_exact',
		recoverability: 'required_inline',
		protected: true,
	},
	recent_history: {
		risk: 'high',
		stability: 'session',
		exactness: 'fact_exact',
		recoverability: 'required_inline',
		protected: false,
	},
	old_history: {
		risk: 'medium',
		stability: 'session',
		exactness: 'semantic',
		recoverability: 'recoverable',
		protected: false,
	},
	retrieved_context: {
		risk: 'medium',
		stability: 'volatile',
		exactness: 'fact_exact',
		recoverability: 'recoverable',
		protected: false,
	},
	tool_schema: {
		risk: 'high',
		stability: 'stable',
		exactness: 'byte_exact',
		recoverability: 'required_inline',
		protected: true,
	},
	tool_call: {
		risk: 'critical',
		stability: 'session',
		exactness: 'byte_exact',
		recoverability: 'required_inline',
		protected: true,
	},
	tool_result: {
		risk: 'high',
		stability: 'volatile',
		exactness: 'fact_exact',
		recoverability: 'recoverable',
		protected: false,
	},
	external_data: {
		risk: 'medium',
		stability: 'volatile',
		exactness: 'fact_exact',
		recoverability: 'recoverable',
		protected: false,
	},
};

export function policyForCategory(category: ContextCategory): CategoryPolicy {
	return categoryPolicies[category];
}
