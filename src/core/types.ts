import type { CanonicalContext } from '../context/types';

export type PublicOptimizerProfileName = 'quality' | 'balanced' | 'savings' | 'custom';
export type LegacyOptimizerProfileName = 'safe' | 'aggressive';
export type OptimizerProfileName = PublicOptimizerProfileName | LegacyOptimizerProfileName;

export interface CustomProfileConfig {
	keepRecentMessages?: number;
	maxInputTokens?: number;
	summaryThresholdTokens?: number;
	approximateDeduplication?: boolean;
	allowUniqueContentTrimming?: boolean;
	minimumNetSavingsTokens?: number;
	eligibleSavingsMinPercent?: number;
	eligibleSavingsMaxPercent?: number;
}

export interface ResolvedProfile {
	name: OptimizerProfileName;
	canonicalName: PublicOptimizerProfileName;
	keepRecentMessages: number;
	maxInputTokens: number;
	summaryThresholdTokens: number;
	approximateDeduplication: boolean;
	allowUniqueContentTrimming: boolean;
	minimumNetSavingsTokens: number;
	eligibleSavingsMinPercent: number;
	eligibleSavingsMaxPercent: number;
	virtualization: 'disabled' | 'automatic' | 'required';
	semanticOptimization: boolean;
}

export interface OptimizeContextInput {
	systemPrompt?: unknown;
	conversationHistory?: unknown;
	retrievedContext?: unknown;
	toolDefinitions?: unknown;
	currentMessage: string;
	protectedValues?: string[] | string;
}

export interface OptimizeContextOptions {
	profile?: OptimizerProfileName;
	custom?: CustomProfileConfig;
}

export interface SummaryRequest {
	text: string;
	maxTokens: number;
	protectedValues: string[];
}

export interface SummaryResult {
	text: string;
	warnings?: string[];
	compressorTokens?: number;
}

export interface SummaryAdapter {
	summarize(request: SummaryRequest): Promise<SummaryResult>;
}

export type FallbackReason =
	| 'protected_fact_missing'
	| 'invalid_summary'
	| 'summary_error'
	| 'empty_result'
	| 'token_budget_unmet'
	| 'negative_net_savings'
	| 'minimum_net_savings_not_met'
	| 'internal_error';

export interface OptimizationMetrics {
	profile: OptimizerProfileName;
	strategy: 'deterministic' | 'hybrid' | 'fallback';
	tokensBefore: number;
	tokensAfter: number;
	budgetMet: boolean;
	tokensAreEstimated: true;
	savingsTokens: number;
	savingsPercent: number;
	grossSavingsTokens?: number;
	netSavingsTokens?: number;
	netSavingsPercent?: number;
	summaryModelUsed: boolean;
	compressorTokens: number;
	protectedFactsCount: number;
	warnings: string[];
	fallback: boolean;
	fallbackReason?: FallbackReason;
	durationMs: number;
}

export interface OptimizeContextResult {
	optimizedSystemPrompt: string;
	optimizedHistory: string;
	optimizedRetrievedContext: string;
	optimizedToolDefinitions: string;
	currentMessage: string;
	optimizedContext: string;
	optimization: OptimizationMetrics;
	canonicalContext?: CanonicalContext;
}

export interface ProtectedFact {
	type: 'money' | 'date' | 'time' | 'email' | 'url' | 'id' | 'number' | 'boolean' | 'custom';
	value: string;
}
