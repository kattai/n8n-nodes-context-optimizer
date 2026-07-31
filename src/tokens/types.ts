export type TokenModelFamily =
	| 'openai'
	| 'anthropic'
	| 'gemini'
	| 'llama'
	| 'mistral'
	| 'generic'
	| 'custom';

export type TokenCountMethod =
	| 'provider_actual'
	| 'exact_adapter'
	| 'custom_ratio'
	| 'calibrated_estimate'
	| 'generic_estimate';

export type TokenCountConfidence = 'exact' | 'high' | 'medium' | 'low';

export interface TokenCountResult {
	tokens: number;
	method: TokenCountMethod;
	confidence: TokenCountConfidence;
	model?: string;
	family: TokenModelFamily;
}

export interface LocalTokenizerAdapter {
	name: string;
	supports(model: string): boolean;
	count(text: string, model: string): number;
}

export interface TokenCountOptions {
	model?: string;
	providerActualTokens?: number;
	charsPerToken?: number;
	adapters?: LocalTokenizerAdapter[];
}

export interface NetSavingsInput {
	originalTokens: number;
	sentTokens: number;
	compressorTokens?: number;
	retrievedTokens?: number;
	verificationTokens?: number;
	minimumNetSavingsTokens?: number;
}

export interface NetSavingsResult {
	grossTokens: number;
	overheadTokens: number;
	netTokens: number;
	netPercent: number;
	positive: boolean;
	useOptimized: boolean;
	reason?: 'negative_net_savings' | 'minimum_net_savings_not_met';
}
