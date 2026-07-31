import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	retrieveContext,
	type RetrievalBudgetState,
	type RetrievalPolicy,
} from '../../src/retrieval/retrieve-context';
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
			evidence: {
				resourceId,
				path: '[0].total',
				exact: true,
			},
		});
		expect(result.evidence?.hash).toMatch(/^[a-f0-9]{64}$/);
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
			totalMatches: 1,
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

	it('uses BM25 ranking and can include adjacent evidence chunks', async () => {
		const result = await retrieveContext(
			store,
			{
				operation: 'search_context',
				resourceId,
				query: 'delayed',
				neighborWindow: 1,
				limit: 5,
			},
			policy,
		);
		const paths = (result.data as { results: Array<{ path: string }> }).results.map(
			(entry) => entry.path,
		);

		expect(paths).toContain('$[0]');
		expect(paths).toContain('$[1]');
	});

	it('supports safe JSONPath roots, compound filters, and nested field projection', async () => {
		const result = await retrieveContext(
			store,
			{
				operation: 'filter_records',
				resourceId,
				path: '$',
				where: [
					{ path: 'status', operator: 'eq', value: 'delayed' },
					{ path: 'total', operator: 'gte', value: 1000 },
				],
				filterLogic: 'and',
				fields: ['id', 'total'],
			},
			policy,
		);

		expect(result.data).toEqual({
			count: 1,
			totalMatches: 1,
			records: [{ id: 'ORD-1', total: 12850 }],
		});
		expect(result.evidence).toMatchObject({ path: '$', exact: true });
	});

	it('pages large record sets with a stable cursor and no overlap', async () => {
		const records = Array.from({ length: 9 }, (_, index) => ({
			id: `ROW-${index + 1}`,
			status: 'open',
			note: `record ${index + 1} ${'detail '.repeat(8)}`,
		}));
		const manifest = await store.store({
			content: JSON.stringify({ records }),
			contentType: 'json',
			ttlSeconds: 3600,
			scope: 'workflow-1',
		});
		const pagedPolicy = { ...policy, maxResults: 3, maxTokens: 300 };
		const first = await retrieveContext(
			store,
			{
				operation: 'filter_records',
				resourceId: manifest.resourceId,
				path: '$.records',
				filters: { status: 'open' },
				fields: ['id', 'note'],
			},
			pagedPolicy,
		);
		const cursor = first.pagination?.nextCursor;
		expect(cursor).toBeTruthy();
		expect(first.pagination).toMatchObject({ returned: 3, hasMore: true });
		expect(first.tokensEstimated).toBeLessThanOrEqual(pagedPolicy.maxTokens);

		const second = await retrieveContext(
			store,
			{
				operation: 'filter_records',
				resourceId: manifest.resourceId,
				path: '$.records',
				filters: { status: 'open' },
				fields: ['id', 'note'],
				cursor,
			},
			pagedPolicy,
		);
		const firstIds = (first.data as { records: Array<{ id: string }> }).records.map(
			(record) => record.id,
		);
		const secondIds = (second.data as { records: Array<{ id: string }> }).records.map(
			(record) => record.id,
		);
		expect(secondIds).toHaveLength(3);
		expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
		expect(second.tokensEstimated).toBeLessThanOrEqual(pagedPolicy.maxTokens);

		const invalid = await retrieveContext(
			store,
			{
				operation: 'filter_records',
				resourceId: manifest.resourceId,
				path: '$.records',
				filters: { status: 'closed' },
				fields: ['id', 'note'],
				cursor,
			},
			pagedPolicy,
		);
		expect(invalid.error?.code).toBe('invalid_cursor');
	});

	it('enforces the cumulative execution retrieval budget', async () => {
		const state: RetrievalBudgetState = { tokensUsed: 100 };
		const result = await retrieveContext(
			store,
			{ operation: 'inspect_schema', resourceId },
			{ ...policy, maxExecutionTokens: 100 },
			state,
		);

		expect(result.ok).toBe(false);
		expect(result.error?.code).toBe('execution_budget_exceeded');
		expect(state.tokensUsed).toBe(100);
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
			allowSecretLikeContent: true,
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
			allowSecretLikeContent: true,
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

	it('applies a nested allowlist recursively without exposing sibling fields', async () => {
		const nestedManifest = await store.store({
			content: JSON.stringify([
				{ customer: { name: 'Ana', email: 'ana@example.com' }, status: 'open' },
			]),
			contentType: 'json',
			ttlSeconds: 3600,
			scope: 'workflow-1',
		});
		const result = await retrieveContext(
			store,
			{ operation: 'get_exact_value', resourceId: nestedManifest.resourceId, path: '$[0]' },
			{ ...policy, allowedFields: ['customer.name'], blockedFields: [] },
		);

		expect(result.data).toEqual({ customer: { name: 'Ana' } });
		expect(result.redacted).toBe(true);
	});
});
