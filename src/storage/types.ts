import type { DetectedContentType } from '../content/types';

export interface ResourceManifest {
	storageVersion: 1 | 2;
	resourceId: string;
	contentType: DetectedContentType;
	originalHash: string;
	originalBytes: number;
	originalTokens: number;
	createdAt: string;
	lastAccessedAt?: string;
	expiresAt: string;
	scope: string;
	reuseCount?: number;
	referenceCount?: number;
	sensitivity?: 'standard' | 'secret_like_allowed';
	schemaHash?: string;
	index?: {
		fields: string[];
		recordCount?: number;
	};
	fields?: string[];
	recordCount?: number;
}

export interface StoreResourceInput {
	content: string;
	contentType: DetectedContentType;
	ttlSeconds: number;
	scope: string;
	fields?: string[];
	recordCount?: number;
	allowSecretLikeContent?: boolean;
}

export interface StoredResource {
	manifest: ResourceManifest;
	content: string;
}

export interface ResourceStore {
	store(input: StoreResourceInput): Promise<ResourceManifest>;
	inspect(resourceId: string, scope?: string): Promise<ResourceManifest>;
	read(resourceId: string, scope?: string): Promise<StoredResource>;
	delete(resourceId: string, scope?: string): Promise<boolean>;
	purgeExpired(now?: Date): Promise<number>;
}
