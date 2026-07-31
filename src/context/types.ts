export type ContextCategory =
	| 'system_instructions'
	| 'current_message'
	| 'recent_history'
	| 'old_history'
	| 'retrieved_context'
	| 'tool_schema'
	| 'tool_call'
	| 'tool_result'
	| 'external_data';

export type ContextRisk = 'critical' | 'high' | 'medium' | 'low';
export type ContextStability = 'stable' | 'session' | 'volatile';
export type ContextExactness = 'byte_exact' | 'fact_exact' | 'semantic';
export type ContextRecoverability = 'required_inline' | 'recoverable' | 'disposable';
export type ToolSequenceStatus = 'active' | 'recent_completed' | 'archived_completed' | 'invalid';

export interface ContextBlock {
	id: string;
	category: ContextCategory;
	order: number;
	content: unknown;
	text: string;
	hash: string;
	risk: ContextRisk;
	stability: ContextStability;
	exactness: ContextExactness;
	recoverability: ContextRecoverability;
	protected: boolean;
	source?: string;
	metadata?: Record<string, unknown>;
}

export interface ToolSchemaBlock extends ContextBlock {
	category: 'tool_schema';
	toolName: string;
}

export interface ToolSequence {
	id: string;
	callIds: string[];
	messageIndexes: number[];
	status: ToolSequenceStatus;
	hash: string;
	issue?: string;
}

export interface CanonicalContext {
	version: 1;
	blocks: ContextBlock[];
	toolSequences: ToolSequence[];
	hash: string;
}

export interface CanonicalContextInput {
	systemPrompt?: unknown;
	currentMessage: unknown;
	conversationHistory?: unknown;
	retrievedContext?: unknown;
	toolDefinitions?: unknown;
	externalData?: unknown;
}
