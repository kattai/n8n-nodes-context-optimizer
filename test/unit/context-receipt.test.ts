import { describe, expect, it } from 'vitest';
import {
	createContextReceipt,
	renderContextReceipt,
	verifyContextReceipt,
} from '../../src/receipts/context-receipt';
import type { ResourceManifest } from '../../src/storage/types';

const manifest: ResourceManifest = {
	storageVersion: 2,
	resourceId: 'ctx_1234567890abcdef12345678',
	contentType: 'json',
	originalHash: 'a'.repeat(64),
	originalBytes: 100,
	originalTokens: 25,
	createdAt: '2026-07-31T00:00:00.000Z',
	expiresAt: '2026-08-01T00:00:00.000Z',
	scope: 'workflow-1',
	fields: ['id', 'status'],
	recordCount: 10,
};

describe('context receipts', () => {
	it('contains only compact verification and retrieval metadata', () => {
		const receipt = createContextReceipt(manifest);
		expect(receipt).toMatchObject({
			id: manifest.resourceId,
			hash: manifest.originalHash,
			tokens: 25,
			records: 10,
		});
		expect(JSON.stringify(receipt)).not.toContain('original content');
		expect(renderContextReceipt(receipt)).toContain('exact_retrieval="required"');
		expect(verifyContextReceipt(receipt, manifest)).toBe(true);
	});

	it('rejects a receipt whose hash was changed', () => {
		const receipt = { ...createContextReceipt(manifest), hash: 'b'.repeat(64) };
		expect(verifyContextReceipt(receipt, manifest)).toBe(false);
	});
});
