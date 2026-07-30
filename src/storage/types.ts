import type { DetectedContentType } from '../content/types';

export interface ResourceManifest {
	storageVersion: 1;
	resourceId: string;
	contentType: DetectedContentType;
	originalHash: string;
	originalBytes: number;
	originalTokens: number;
	createdAt: string;
	expiresAt: string;
	scope: string;
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
}

export interface StoredResource {
	manifest: ResourceManifest;
	content: string;
}

export interface ResourceStore {
	store(input: StoreResourceInput): Promise<ResourceManifest>;
	inspect(resourceId: string): Promise<ResourceManifest>;
	read(resourceId: string): Promise<StoredResource>;
	delete(resourceId: string): Promise<boolean>;
	purgeExpired(now?: Date): Promise<number>;
}
