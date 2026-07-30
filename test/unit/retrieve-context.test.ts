import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { retrieveContext, type RetrievalPolicy } from '../../src/retrieval/retrieve-context';
import { FileSystemResourceStore } from '../../src/storage/filesystem-store';

let directory = '';
let store: FileSystemResourceStore;
let resourceId = '';
const policy: RetrievalPolicy = {
	scope: 'workflow-1',
	maxResults: 5,
	maxTokens: 500,
	allowedFields: [],
	blockedFields: ['secret'],
	allowFullOriginal: false,
};

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'context-retriever-'));
	store = new FileSystemResourceStore(directory);
	const manifest = await store.store({
		content: JSON.stringify([
			{ id: 'ORD-1', status: 'delayed', total: 12850, secret: 'hidden' },
			{ id: 'ORD-2', status: 'paid', total: 200, secret: 'hidden' },
		]),
		contentType: 'json',
		ttlSeconds: 3600,
		scope: 'workflow-1',
		fields: ['id', 'status', 'total', 'secret'],
		recordCount: 2,
	});
	resourceId = manifest.resourceId;
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

describe('retrieveContext', () => {
	it('retrieves one exact JSON value with evidence', async () => {
		const result = await retrieveContext(
			store,
			{ operation: 'get_exact_value', resourceId, path: '[0].total' },
			policy,
		);

		expect(result).toMatchObject({
			ok: true,
			exact: true,
			path: '[0].total',
			data: 12850,
		});
	});

	it('filters records and omits blocked fields', async () => {
		const result = await retrieveContext(
			store,
			{
				operation: 'filter_records',
				resourceId,
				filters: { status: 'delayed' },
				fields: ['id', 'total'],
			},
			policy,
		);

		expect(result.data).toEqual({
			count: 1,
			records: [{ id: 'ORD-1', total: 12850 }],
		});
	});

	it('blocks protected fields and cross-scope reads', async () => {
		const blocked = await retrieveContext(
			store,
			{ operation: 'get_exact_value', resourceId, path: '[0].secret' },
			policy,
		);
		const wrongScope = await retrieveContext(
			store,
			{ operation: 'inspect_schema', resourceId },
			{ ...policy, scope: 'workflow-2' },
		);

		expect(blocked.ok).toBe(false);
		expect(blocked.error?.message).toContain('not allowed');
		expect(wrongScope.error?.code).toBe('scope_mismatch');
	});

	it('searches records lexically and respects result limit', async () => {
		const result = await retrieveContext(
			store,
			{
				operation: 'search_context',
				resourceId,
				query: 'delayed',
				limit: 1,
			},
			policy,
		);

		expect(result.ok).toBe(true);
		expect(result.data).toMatchObject({ count: 1 });
	});

	it('deeply redacts blocked fields from search and parent-object reads', async () => {
		const nestedManifest = await store.store({
			content: JSON.stringify([
				{
					id: 'LEAD-1',
					customer: { name: 'Ana', password: 'TOPSECRET' },
					status: 'open',
				},
			]),
			contentType: 'json',
			ttlSeconds: 3600,
			scope: 'workflow-1',
		});
		const nestedPolicy = { ...policy, blockedFields: ['password'] };

		const search = await retrieveContext(
			store,
			{
				operation: 'search_context',
				resourceId: nestedManifest.resourceId,
				query: 'Ana',
			},
			nestedPolicy,
		);
		const parent = await retrieveContext(
			store,
			{
				operation: 'get_exact_value',
				resourceId: nestedManifest.resourceId,
				path: '[0].customer',
			},
			nestedPolicy,
		);
		const root = await retrieveContext(
			store,
			{
				operation: 'get_exact_value',
				resourceId: nestedManifest.resourceId,
				path: '[0]',
			},
			nestedPolicy,
		);

		expect(JSON.stringify(search.data)).not.toContain('TOPSECRET');
		expect(parent.data).toEqual({ name: 'Ana' });
		expect(root.data).toEqual({
			id: 'LEAD-1',
			customer: { name: 'Ana' },
			status: 'open',
		});
		expect(parent.redacted).toBe(true);
	});

	it('blocks nested protected paths and raw retrieval when redaction is active', async () => {
		const nestedManifest = await store.store({
			content: JSON.stringify([{ customer: { password: 'TOPSECRET' } }]),
			contentType: 'json',
			ttlSeconds: 3600,
			scope: 'workflow-1',
		});
		const nestedPolicy = { ...policy, blockedFields: ['password'] };

		const exact = await retrieveContext(
			store,
			{
				operation: 'get_exact_value',
				resourceId: nestedManifest.resourceId,
				path: '[0].customer.password',
			},
			nestedPolicy,
		);
		const fragment = await retrieveContext(
			store,
			{
				operation: 'get_original_fragment',
				resourceId: nestedManifest.resourceId,
				start: 0,
				end: 200,
			},
			nestedPolicy,
		);

		expect(exact.ok).toBe(false);
		expect(exact.error?.code).toBe('field_not_allowed');
		expect(fragment.ok).toBe(false);
		expect(fragment.error?.code).toBe('raw_retrieval_blocked');
	});
});
