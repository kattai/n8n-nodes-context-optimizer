import type { ResourceManifest } from './types';

export interface ResourceIndexEntry {
	resourceId: string;
	scope: string;
	originalHash: string;
	contentType: string;
	expiresAt: string;
	fields: string[];
	recordCount?: number;
}

export function buildResourceIndex(manifests: ResourceManifest[]): ResourceIndexEntry[] {
	return manifests
		.map((manifest) => ({
			resourceId: manifest.resourceId,
			scope: manifest.scope,
			originalHash: manifest.originalHash,
			contentType: manifest.contentType,
			expiresAt: manifest.expiresAt,
			fields: manifest.fields ?? [],
			...(manifest.recordCount === undefined ? {} : { recordCount: manifest.recordCount }),
		}))
		.sort((left, right) => left.resourceId.localeCompare(right.resourceId));
}

export function findIndexedResource(
	index: ResourceIndexEntry[],
	scope: string,
	originalHash: string,
): ResourceIndexEntry | undefined {
	return index.find((entry) => entry.scope === scope && entry.originalHash === originalHash);
}
