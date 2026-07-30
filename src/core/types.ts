export type OptimizerProfileName = 'safe' | 'balanced' | 'aggressive' | 'custom';

export interface CustomProfileConfig {
	keepRecentMessages?: number;
	maxInputTokens?: number;
	summaryThresholdTokens?: number;
	approximateDeduplication?: boolean;
	allowUniqueContentTrimming?: boolean;
}

export interface ResolvedProfile {
	name: OptimizerProfileName;
	keepRecentMessages: number;
	maxInputTokens: number;
	summaryThresholdTokens: number;
	approximateDeduplication: boolean;
	allowUniqueContentTrimming: boolean;
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
}

export interface ProtectedFact {
	type: 'money' | 'date' | 'time' | 'email' | 'url' | 'id' | 'number' | 'boolean' | 'custom';
	value: string;
}
