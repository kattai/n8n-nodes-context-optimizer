import type { ResourceManifest } from '../storage/types';

export interface ContextReceipt {
	v: 1;
	id: string;
	type: string;
	hash: string;
	tokens: number;
	expiresAt: string;
	fields?: string[];
	records?: number;
}

export function createContextReceipt(manifest: ResourceManifest): ContextReceipt {
	return {
		v: 1,
		id: manifest.resourceId,
		type: manifest.contentType,
		hash: manifest.originalHash,
		tokens: manifest.originalTokens,
		expiresAt: manifest.expiresAt,
		...(manifest.fields && manifest.fields.length > 0 ? { fields: manifest.fields } : {}),
		...(manifest.recordCount === undefined ? {} : { records: manifest.recordCount }),
	};
}

export function verifyContextReceipt(receipt: ContextReceipt, manifest: ResourceManifest): boolean {
	return (
		receipt.v === 1 &&
		receipt.id === manifest.resourceId &&
		receipt.hash === manifest.originalHash &&
		receipt.tokens === manifest.originalTokens &&
		receipt.expiresAt === manifest.expiresAt
	);
}

export function renderContextReceipt(receipt: ContextReceipt): string {
	return `<context-resource id="${receipt.id}" type="${receipt.type}" hash="${receipt.hash}" tokens="${receipt.tokens}" exact_retrieval="required" />`;
}
