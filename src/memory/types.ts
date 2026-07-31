export type MemoryMessageRole = 'assistant' | 'system' | 'tool' | 'user';
export type ProtectedMemoryKind = 'active_failure' | 'correction' | 'decision' | 'pending';

export interface MemoryMessageInput {
	id?: string;
	role: MemoryMessageRole;
	content: string;
	createdAt?: string;
	kind?: ProtectedMemoryKind;
	protected?: boolean;
	metadata?: Record<string, unknown>;
}

export interface MemoryMessage extends MemoryMessageInput {
	id: string;
	createdAt: string;
}

export interface FactVersion {
	version: number;
	value: unknown;
	status: 'superseded';
	validFrom: string;
	validUntil: string;
}

export interface VersionedFact {
	key: string;
	value: unknown;
	version: number;
	status: 'current';
	updatedAt: string;
	history: FactVersion[];
}

export interface IncrementalSummary {
	text: string;
	hash: string;
	basedOnRevision: number;
	updatedAt: string;
}

export interface ArchivedMemoryEvent {
	id: string;
	type: 'message';
	message: MemoryMessage;
	archivedAt: string;
}

export interface ArchivedResourceReference {
	resourceId: string;
	description?: string;
	addedAt: string;
}

export interface MemorySession {
	storageVersion: 1;
	sessionKey: string;
	scope: string;
	revision: number;
	createdAt: string;
	updatedAt: string;
	expiresAt: string;
	recentWindow: number;
	pinnedFacts: Record<string, VersionedFact>;
	structuredState: Record<string, unknown>;
	recentMessages: MemoryMessage[];
	protectedItems: MemoryMessage[];
	incrementalSummary?: IncrementalSummary;
	archivedEvents: ArchivedMemoryEvent[];
	archivedResources: ArchivedResourceReference[];
}

export interface UpdateMemorySessionInput {
	sessionKey: string;
	scope: string;
	ttlSeconds?: number;
	recentWindow?: number;
	pinnedFacts?: Record<string, unknown>;
	structuredState?: Record<string, unknown>;
	stateMode?: 'merge' | 'replace';
	messages?: MemoryMessageInput[];
	summaryCandidate?: string;
	summaryBasedOnRevision?: number;
	summaryRequiredValues?: string[];
	summaryMaximumTokens?: number;
	archivedResources?: Array<string | { resourceId: string; description?: string }>;
}

export interface UpdateMemorySessionResult {
	session: MemorySession;
	warnings: string[];
}

export interface BuildMemoryContextInput {
	sessionKey: string;
	scope: string;
}

export interface BuildMemoryContextResult {
	sessionKey: string;
	scope: string;
	revision: number;
	context: string;
	estimatedTokens: number;
	included: {
		currentFacts: number;
		stateFields: number;
		protectedItems: number;
		recentMessages: number;
		archivedResources: number;
		summary: boolean;
	};
	archivedEventCount: number;
}
