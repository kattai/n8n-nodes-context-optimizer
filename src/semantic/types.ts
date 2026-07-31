export type SemanticUnitSource = 'history' | 'retrieved_context';

export interface SemanticUnit {
	id: string;
	source: SemanticUnitSource;
	index: number;
	text: string;
	protected: boolean;
}

export interface SemanticSelectionRequest {
	units: SemanticUnit[];
	currentTask: string;
	protectedIds: string[];
}

export interface SemanticDeduplicationResponse {
	keepIds: string[];
	confidence: number;
	compressorTokens?: number;
}

export interface SemanticRerankResponse {
	rankedIds: string[];
	confidence: number;
	compressorTokens?: number;
}

export interface SemanticDeduplicationAdapter {
	deduplicate(request: SemanticSelectionRequest): Promise<SemanticDeduplicationResponse>;
}

export interface SemanticRerankAdapter {
	rerank(request: SemanticSelectionRequest): Promise<SemanticRerankResponse>;
}

export interface SemanticJudgeRequest {
	original: string;
	candidate: string;
	currentTask: string;
	protectedValues: string[];
}

export interface SemanticJudgeResponse {
	meaningPreserved: boolean;
	missingFacts: string[];
	contradictions: string[];
	confidence: number;
	verificationTokens?: number;
}

export interface SemanticJudgeAdapter {
	verify(request: SemanticJudgeRequest): Promise<SemanticJudgeResponse>;
}

export interface SemanticPipelineAdapters {
	deduplication?: SemanticDeduplicationAdapter;
	reranking?: SemanticRerankAdapter;
	judge?: SemanticJudgeAdapter;
}

export interface SemanticPipelineConfiguration {
	deduplicate?: boolean;
	rerank?: boolean;
	judge?: boolean;
	minimumConfidence?: number;
	maximumUnits?: number;
	maximumSelectedUnits?: number;
	tokenBudget?: number;
}

export type SemanticFallbackReason =
	| 'adapter_error'
	| 'invalid_adapter_response'
	| 'low_confidence'
	| 'negative_net_savings'
	| 'no_reduction'
	| 'protected_unit_missing'
	| 'too_many_units';

export interface SemanticStageResult {
	units: SemanticUnit[];
	applied: boolean;
	confidence: number;
	compressorTokens: number;
	savedTokens: number;
	fallbackReason?: SemanticFallbackReason;
}
