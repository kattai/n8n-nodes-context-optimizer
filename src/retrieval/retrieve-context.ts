/* eslint-disable @n8n/community-nodes/require-node-api-error -- Retrieval core has no n8n execution context; the tool adapter returns structured errors. */
import { createHash } from 'node:crypto';
import { estimateTokens } from '../core/token-estimator';
import { bm25Scores } from '../relevance/bm25';
import { ResourceScopeError } from '../storage/filesystem-store';
import type { ResourceStore, StoredResource } from '../storage/types';

export type RetrievalOperation =
	| 'search_context'
	| 'filter_records'
	| 'get_exact_value'
	| 'get_section'
	| 'inspect_schema'
	| 'get_original_fragment';

export type FilterOperator =
	| 'eq'
	| 'ne'
	| 'gt'
	| 'gte'
	| 'lt'
	| 'lte'
	| 'contains'
	| 'starts_with'
	| 'ends_with'
	| 'in'
	| 'exists';

export interface RetrievalFilter {
	path: string;
	operator: FilterOperator;
	value?: string | number | boolean | null | Array<string | number | boolean | null>;
}

export interface RetrievalRequest {
	operation: RetrievalOperation;
	resourceId: string;
	query?: string;
	path?: string;
	filters?: Record<string, string | number | boolean | null>;
	where?: RetrievalFilter[];
	filterLogic?: 'and' | 'or';
	fields?: string[];
	limit?: number;
	cursor?: string;
	neighborWindow?: number;
	section?: number;
	start?: number;
	end?: number;
}

export interface RetrievalPolicy {
	scope: string;
	maxResults: number;
	maxTokens: number;
	maxExecutionTokens?: number;
	allowedFields: string[];
	blockedFields: string[];
	allowFullOriginal: boolean;
}

export interface RetrievalBudgetState {
	tokensUsed: number;
}

export interface RetrievalEvidence {
	resourceId: string;
	path?: string;
	hash: string;
	exact: boolean;
}

export interface RetrievalPagination {
	returned: number;
	hasMore: boolean;
	nextCursor?: string;
}

export interface RetrievalResult {
	ok: boolean;
	operation: RetrievalOperation;
	resourceId: string;
	exact: boolean;
	data?: unknown;
	path?: string;
	evidence?: RetrievalEvidence;
	pagination?: RetrievalPagination;
	redacted?: boolean;
	truncated?: boolean;
	tokensEstimated?: number;
	error?: {
		code: string;
		message: string;
	};
}

interface CursorPayload {
	v: 1;
	resourceId: string;
	operation: RetrievalOperation;
	offset: number;
	fingerprint: string;
}

const blockedPathParts = new Set(['__proto__', 'prototype', 'constructor']);

class RetrievalPolicyError extends Error {
	constructor(
		public readonly code: string,
		message: string,
	) {
		super(message);
		this.name = code;
	}
}

function normalize(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();
}

function parsePath(path: string): Array<string | number> {
	const value = path.trim();
	if (!value || value === '$') return [];
	const parts: Array<string | number> = [];
	let index = value.startsWith('$') ? 1 : 0;
	while (index < value.length) {
		if (value[index] === '.') index++;
		if (index >= value.length) throw new Error('Invalid path');
		if (value[index] === '[') {
			const remainder = value.slice(index);
			const numeric = remainder.match(/^\[(\d+)\]/);
			const quoted = remainder.match(/^\[['"]([^'"]+)['"]\]/);
			const match = numeric ?? quoted;
			if (!match) throw new Error('Invalid path');
			const part = numeric ? Number(match[1]) : match[1];
			if (typeof part === 'string' && blockedPathParts.has(part)) {
				throw new Error('Blocked path segment');
			}
			parts.push(part);
			index += match[0].length;
			continue;
		}
		const property = value.slice(index).match(/^([A-Za-z_$][\w$-]*)/);
		if (!property) throw new Error('Invalid path');
		if (blockedPathParts.has(property[1])) throw new Error('Blocked path segment');
		parts.push(property[1]);
		index += property[0].length;
	}
	return parts;
}

function valueAtPath(root: unknown, path: string): unknown {
	let value = root;
	for (const part of parsePath(path)) {
		if (value === null || value === undefined || typeof value !== 'object') return undefined;
		value = (value as Record<string | number, unknown>)[part];
	}
	return value;
}

function policyFields(values: string[]): Set<string> {
	return new Set(values.map(normalize));
}

function canonicalFieldPath(path: string): string {
	try {
		return parsePath(path)
			.filter((part): part is string => typeof part === 'string')
			.map(normalize)
			.join('.');
	} catch {
		return normalize(path.replace(/^\$\.?/, ''));
	}
}

function fieldAllowed(field: string, policy: RetrievalPolicy): boolean {
	const normalized = canonicalFieldPath(field);
	const pathParts = normalized.split('.');
	const leaf = pathParts[pathParts.length - 1] ?? normalized;
	if (policyFields(policy.blockedFields).has(normalized)) return false;
	const allowed = new Set(policy.allowedFields.map(canonicalFieldPath));
	return policy.allowedFields.length === 0 || allowed.has(normalized) || allowed.has(leaf);
}

function enforceField(path: string, policy: RetrievalPolicy): void {
	const fields = parsePath(path).filter((part): part is string => typeof part === 'string');
	const blocked = policyFields(policy.blockedFields);
	const blockedField = fields.find((field) => blocked.has(normalize(field)));
	if (blockedField) {
		throw new RetrievalPolicyError('field_not_allowed', `Field is not allowed: ${blockedField}`);
	}
	const leaf = fields[fields.length - 1];
	const canonical = fields.map(normalize).join('.');
	const allowed = new Set(policy.allowedFields.map(canonicalFieldPath));
	const parentOfAllowed = [...allowed].some((entry) => entry.startsWith(`${canonical}.`));
	if (
		leaf &&
		policy.allowedFields.length > 0 &&
		!fieldAllowed(canonical, policy) &&
		!parentOfAllowed
	) {
		throw new RetrievalPolicyError('field_not_allowed', `Field is not allowed: ${leaf}`);
	}
}

interface SanitizedValue {
	value: unknown;
	redacted: boolean;
	included: boolean;
}

function sanitizeValue(
	value: unknown,
	policy: RetrievalPolicy,
	ancestorAllowed = false,
	currentPath = '',
): SanitizedValue {
	const allowed = new Set(policy.allowedFields.map(canonicalFieldPath));
	const blocked = policyFields(policy.blockedFields);
	const restricted = allowed.size > 0;
	if (Array.isArray(value)) {
		let redacted = false;
		const result: unknown[] = [];
		for (const entry of value) {
			const sanitized = sanitizeValue(entry, policy, ancestorAllowed, currentPath);
			redacted ||= sanitized.redacted;
			if (sanitized.included) result.push(sanitized.value);
			else redacted = true;
		}
		return {
			value: result,
			redacted,
			included: !restricted || ancestorAllowed || result.length > 0,
		};
	}
	if (!value || typeof value !== 'object') {
		return {
			value,
			redacted: restricted && !ancestorAllowed,
			included: !restricted || ancestorAllowed,
		};
	}

	let redacted = false;
	const result: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		const normalizedKey = normalize(key);
		if (blocked.has(normalizedKey)) {
			redacted = true;
			continue;
		}
		const childPath = currentPath ? `${currentPath}.${normalizedKey}` : normalizedKey;
		const keyAllowed = ancestorAllowed || allowed.has(normalizedKey) || allowed.has(childPath);
		const containsAllowed = [...allowed].some((path) => path.startsWith(`${childPath}.`));
		const sanitized = sanitizeValue(entry, policy, keyAllowed, childPath);
		redacted ||= sanitized.redacted;
		if (!restricted || keyAllowed || containsAllowed || sanitized.included)
			result[key] = sanitized.value;
		else redacted = true;
	}
	return {
		value: result,
		redacted,
		included: !restricted || ancestorAllowed || Object.keys(result).length > 0,
	};
}

function parseJson(content: string): unknown {
	try {
		return JSON.parse(content);
	} catch {
		throw new Error('Resource is not valid JSON');
	}
}

function recordsAtPath(content: string, path = ''): unknown[] {
	const parsed = parseJson(content);
	const value = path ? valueAtPath(parsed, path) : parsed;
	if (!Array.isArray(value)) throw new Error('Selected value is not an array');
	return value;
}

function assignPath(target: Record<string, unknown>, path: string, value: unknown): void {
	const parts = parsePath(path).filter((part): part is string => typeof part === 'string');
	if (parts.length === 0) return;
	let current = target;
	for (const part of parts.slice(0, -1)) {
		const existing = current[part];
		if (!existing || typeof existing !== 'object' || Array.isArray(existing)) current[part] = {};
		current = current[part] as Record<string, unknown>;
	}
	current[parts[parts.length - 1]] = value;
}

function selectFields(record: unknown, fields: string[], policy: RetrievalPolicy): SanitizedValue {
	if (!record || typeof record !== 'object' || Array.isArray(record)) {
		return sanitizeValue(record, policy);
	}
	if (fields.length === 0) return sanitizeValue(record, policy);
	const value: Record<string, unknown> = {};
	let redacted = false;
	for (const field of fields) {
		enforceField(field, policy);
		const sourceValue = valueAtPath(record, field);
		if (sourceValue === undefined) continue;
		const sanitized = sanitizeValue(sourceValue, policy, true);
		redacted ||= sanitized.redacted;
		if (sanitized.included) assignPath(value, field, sanitized.value);
	}
	return { value, redacted, included: true };
}

function comparable(value: unknown): string | number | boolean | null | undefined {
	return typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		value === null
		? value
		: undefined;
}

function matchesFilter(record: unknown, filter: RetrievalFilter, policy: RetrievalPolicy): boolean {
	enforceField(filter.path, policy);
	const actual = valueAtPath(record, filter.path);
	const expected = filter.value;
	switch (filter.operator) {
		case 'eq':
			return actual === expected;
		case 'ne':
			return actual !== expected;
		case 'gt':
			return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
		case 'gte':
			return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
		case 'lt':
			return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
		case 'lte':
			return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
		case 'contains':
			return Array.isArray(actual)
				? actual.some((entry) => comparable(entry) === expected)
				: typeof actual === 'string' &&
						typeof expected === 'string' &&
						normalize(actual).includes(normalize(expected));
		case 'starts_with':
			return (
				typeof actual === 'string' &&
				typeof expected === 'string' &&
				normalize(actual).startsWith(normalize(expected))
			);
		case 'ends_with':
			return (
				typeof actual === 'string' &&
				typeof expected === 'string' &&
				normalize(actual).endsWith(normalize(expected))
			);
		case 'in':
			return Array.isArray(expected) && expected.includes(comparable(actual) ?? null);
		case 'exists':
			return (actual !== undefined) === (typeof expected === 'boolean' ? expected : true);
	}
}

function filtersForRequest(request: RetrievalRequest): RetrievalFilter[] {
	return [
		...Object.entries(request.filters ?? {}).map(([path, value]) => ({
			path,
			operator: 'eq' as const,
			value,
		})),
		...(request.where ?? []),
	];
}

function matchesFilters(
	record: unknown,
	request: RetrievalRequest,
	policy: RetrievalPolicy,
): boolean {
	if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
	const filters = filtersForRequest(request);
	if (filters.length === 0) return true;
	const matches = filters.map((filter) => matchesFilter(record, filter, policy));
	return request.filterLogic === 'or' ? matches.some(Boolean) : matches.every(Boolean);
}

function stableValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableValue);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, stableValue(entry)]),
	);
}

function cursorFingerprint(request: RetrievalRequest, originalHash: string): string {
	return createHash('sha256')
		.update(
			JSON.stringify(
				stableValue({
					resourceId: request.resourceId,
					operation: request.operation,
					query: request.query,
					path: request.path,
					filters: request.filters,
					where: request.where,
					filterLogic: request.filterLogic,
					fields: request.fields,
					neighborWindow: request.neighborWindow,
					originalHash,
				}),
			),
		)
		.digest('hex')
		.slice(0, 24);
}

function encodeCursor(payload: CursorPayload): string {
	return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function cursorOffset(request: RetrievalRequest, originalHash: string): number {
	if (!request.cursor) return 0;
	try {
		const payload = JSON.parse(
			Buffer.from(request.cursor, 'base64url').toString('utf8'),
		) as CursorPayload;
		if (
			payload.v !== 1 ||
			payload.resourceId !== request.resourceId ||
			payload.operation !== request.operation ||
			payload.fingerprint !== cursorFingerprint(request, originalHash) ||
			!Number.isSafeInteger(payload.offset) ||
			payload.offset < 0
		) {
			throw new Error('Cursor does not match this query');
		}
		return payload.offset;
	} catch (error) {
		throw new RetrievalPolicyError(
			'invalid_cursor',
			error instanceof Error ? error.message : 'Invalid cursor',
		);
	}
}

function nextCursor(request: RetrievalRequest, originalHash: string, offset: number): string {
	return encodeCursor({
		v: 1,
		resourceId: request.resourceId,
		operation: request.operation,
		offset,
		fingerprint: cursorFingerprint(request, originalHash),
	});
}

function evidence(resource: StoredResource, path?: string, exact = true): RetrievalEvidence {
	return {
		resourceId: resource.manifest.resourceId,
		...(path ? { path } : {}),
		hash: resource.manifest.originalHash,
		exact,
	};
}

function estimateResult(result: RetrievalResult): number {
	return estimateTokens(JSON.stringify(result));
}

function availableTokens(policy: RetrievalPolicy, state?: RetrievalBudgetState): number {
	const executionLimit = policy.maxExecutionTokens ?? Number.POSITIVE_INFINITY;
	const remaining = executionLimit - (state?.tokensUsed ?? 0);
	return Math.max(0, Math.min(policy.maxTokens, remaining));
}

function resultError(request: RetrievalRequest, code: string, message: string): RetrievalResult {
	return {
		ok: false,
		operation: request.operation,
		resourceId: request.resourceId,
		exact: false,
		error: { code, message },
	};
}

function finalizeResult(
	result: RetrievalResult,
	request: RetrievalRequest,
	policy: RetrievalPolicy,
	state?: RetrievalBudgetState,
): RetrievalResult {
	const maximum = availableTokens(policy, state);
	if (maximum <= 0) {
		return resultError(
			request,
			'execution_budget_exceeded',
			'Execution retrieval budget exhausted',
		);
	}
	const tokens = estimateResult(result);
	if (tokens > maximum) {
		return resultError(
			request,
			'retrieval_budget_exceeded',
			`Result requires about ${tokens} tokens; current retrieval budget is ${maximum}`,
		);
	}
	if (state) state.tokensUsed += tokens;
	return { ...result, tokensEstimated: tokens };
}

function pagedResult<T>(options: {
	request: RetrievalRequest;
	resource: StoredResource;
	policy: RetrievalPolicy;
	state?: RetrievalBudgetState;
	entries: T[];
	offset: number;
	limit: number;
	path: string;
	redacted: boolean;
	buildData: (page: T[]) => unknown;
}): RetrievalResult {
	const maximum = availableTokens(options.policy, options.state);
	if (maximum <= 0) {
		return resultError(
			options.request,
			'execution_budget_exceeded',
			'Execution retrieval budget exhausted',
		);
	}
	const availableEntries = options.entries.slice(options.offset);
	let page: T[] = [];
	let candidate: RetrievalResult | undefined;
	for (const entry of availableEntries.slice(0, options.limit)) {
		const nextPage = [...page, entry];
		const nextOffset = options.offset + nextPage.length;
		const hasMore = nextOffset < options.entries.length;
		const attempt: RetrievalResult = {
			ok: true,
			operation: options.request.operation,
			resourceId: options.request.resourceId,
			exact: true,
			path: options.path,
			data: options.buildData(nextPage),
			evidence: evidence(options.resource, options.path),
			pagination: {
				returned: nextPage.length,
				hasMore,
				...(hasMore
					? {
							nextCursor: nextCursor(
								options.request,
								options.resource.manifest.originalHash,
								nextOffset,
							),
						}
					: {}),
			},
			redacted: options.redacted,
		};
		if (estimateResult(attempt) > maximum) break;
		page = nextPage;
		candidate = attempt;
	}
	if (!candidate) {
		const hasMore = options.offset < options.entries.length;
		candidate = {
			ok: true,
			operation: options.request.operation,
			resourceId: options.request.resourceId,
			exact: true,
			path: options.path,
			data: options.buildData([]),
			evidence: evidence(options.resource, options.path),
			pagination: {
				returned: 0,
				hasMore,
				...(hasMore
					? {
							nextCursor: nextCursor(
								options.request,
								options.resource.manifest.originalHash,
								options.offset,
							),
						}
					: {}),
			},
			redacted: options.redacted,
		};
		if (hasMore) {
			return resultError(
				options.request,
				'record_exceeds_budget',
				`One result does not fit within the ${maximum}-token retrieval budget`,
			);
		}
	}
	return finalizeResult(candidate, options.request, options.policy, options.state);
}

function searchableChunks(
	resource: StoredResource,
	policy: RetrievalPolicy,
): { chunks: Array<{ path: string; content: unknown }>; redacted: boolean } {
	let redacted = false;
	try {
		const parsed = JSON.parse(resource.content) as unknown;
		const chunks = Array.isArray(parsed)
			? parsed.map((content, index) => ({ path: `$[${index}]`, content }))
			: Object.entries(parsed as Record<string, unknown>).map(([path, content]) => ({
					path: `$.${path}`,
					content: { [path]: content },
				}));
		return {
			chunks: chunks.map((chunk) => {
				const sanitized = sanitizeValue(chunk.content, policy);
				redacted ||= sanitized.redacted;
				return { ...chunk, content: sanitized.value };
			}),
			redacted,
		};
	} catch {
		if (policy.blockedFields.length > 0 || policy.allowedFields.length > 0) {
			throw new RetrievalPolicyError(
				'raw_retrieval_blocked',
				'Raw text search is blocked while field redaction is active',
			);
		}
		return {
			chunks: resource.content
				.split(/\n{2,}/)
				.map((content, index) => ({ path: `section[${index}]`, content: content.trim() }))
				.filter((entry) => entry.content),
			redacted: false,
		};
	}
}

function searchEntries(
	resource: StoredResource,
	query: string,
	neighborWindow: number,
	policy: RetrievalPolicy,
): { entries: Array<{ path: string; score: number; content: unknown }>; redacted: boolean } {
	const { chunks, redacted } = searchableChunks(resource, policy);
	const scores = bm25Scores(
		query,
		chunks.map((chunk) => JSON.stringify(chunk.content)),
	);
	const matched = scores
		.map((score, index) => ({ score, index }))
		.filter((entry) => !query.trim() || entry.score > 0);
	const indexes = new Map<number, number>();
	for (const match of matched) {
		indexes.set(match.index, Math.max(indexes.get(match.index) ?? 0, match.score));
		for (let distance = 1; distance <= neighborWindow; distance++) {
			for (const index of [match.index - distance, match.index + distance]) {
				if (index < 0 || index >= chunks.length) continue;
				indexes.set(index, Math.max(indexes.get(index) ?? 0, match.score / (distance + 1)));
			}
		}
	}
	return {
		entries: [...indexes.entries()]
			.map(([index, score]) => ({
				path: chunks[index].path,
				score: Number(score.toFixed(4)),
				content: chunks[index].content,
			}))
			.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path)),
		redacted,
	};
}

export async function retrieveContext(
	store: ResourceStore,
	request: RetrievalRequest,
	policy: RetrievalPolicy,
	budgetState?: RetrievalBudgetState,
): Promise<RetrievalResult> {
	try {
		if (availableTokens(policy, budgetState) <= 0) {
			return resultError(
				request,
				'execution_budget_exceeded',
				'Execution retrieval budget exhausted',
			);
		}
		const resource = await store.read(request.resourceId, policy.scope);
		const limit = Math.max(1, Math.min(request.limit ?? policy.maxResults, policy.maxResults));
		const offset = cursorOffset(request, resource.manifest.originalHash);
		let result: RetrievalResult;

		if (request.operation === 'inspect_schema') {
			const fields = (resource.manifest.fields ?? []).filter((field) =>
				fieldAllowed(field, policy),
			);
			result = {
				ok: true,
				operation: request.operation,
				resourceId: request.resourceId,
				exact: true,
				data: {
					contentType: resource.manifest.contentType,
					fields,
					recordCount: resource.manifest.recordCount,
					originalTokens: resource.manifest.originalTokens,
					expiresAt: resource.manifest.expiresAt,
				},
				evidence: evidence(resource),
				redacted: fields.length !== (resource.manifest.fields ?? []).length,
			};
		} else if (request.operation === 'get_exact_value') {
			const path = request.path ?? '';
			enforceField(path, policy);
			const value = valueAtPath(parseJson(resource.content), path);
			if (value === undefined)
				return resultError(request, 'path_not_found', `Path not found: ${path}`);
			const pathFields = parsePath(path).filter((part): part is string => typeof part === 'string');
			const selectedField = pathFields[pathFields.length - 1];
			const selectedFieldAllowed =
				policy.allowedFields.length === 0 ||
				(selectedField !== undefined && fieldAllowed(selectedField, policy));
			const sanitized = sanitizeValue(value, policy, selectedFieldAllowed);
			result = {
				ok: true,
				operation: request.operation,
				resourceId: request.resourceId,
				exact: true,
				path,
				data: sanitized.value,
				evidence: evidence(resource, path),
				redacted: sanitized.redacted,
			};
		} else if (request.operation === 'filter_records') {
			const path = request.path ?? '$';
			if (path !== '$') enforceField(path, policy);
			const fields = request.fields ?? [];
			for (const field of fields) enforceField(field, policy);
			let redacted = false;
			const records = recordsAtPath(resource.content, path)
				.filter((record) => matchesFilters(record, request, policy))
				.map((record) => {
					const selected = selectFields(record, fields, policy);
					redacted ||= selected.redacted;
					return selected.value;
				});
			return pagedResult({
				request,
				resource,
				policy,
				state: budgetState,
				entries: records,
				offset,
				limit,
				path,
				redacted,
				buildData: (page) => ({ count: page.length, totalMatches: records.length, records: page }),
			});
		} else if (request.operation === 'search_context') {
			const search = searchEntries(
				resource,
				request.query ?? '',
				Math.max(0, Math.min(request.neighborWindow ?? 1, 5)),
				policy,
			);
			return pagedResult({
				request,
				resource,
				policy,
				state: budgetState,
				entries: search.entries,
				offset,
				limit,
				path: '$',
				redacted: search.redacted,
				buildData: (page) => ({
					count: page.length,
					totalMatches: search.entries.length,
					results: page,
				}),
			});
		} else if (request.operation === 'get_section') {
			if (policy.blockedFields.length > 0 || policy.allowedFields.length > 0) {
				return resultError(
					request,
					'raw_retrieval_blocked',
					'Raw section retrieval is blocked while field redaction is active',
				);
			}
			const sections = resource.content
				.split(/\n{2,}/)
				.map((section) => section.trim())
				.filter(Boolean);
			const section = Math.max(0, request.section ?? 0);
			if (section >= sections.length)
				return resultError(request, 'section_not_found', `Section not found: ${section}`);
			const path = `section[${section}]`;
			result = {
				ok: true,
				operation: request.operation,
				resourceId: request.resourceId,
				exact: true,
				path,
				data: sections[section],
				evidence: evidence(resource, path),
			};
		} else {
			if (policy.blockedFields.length > 0 || policy.allowedFields.length > 0) {
				return resultError(
					request,
					'raw_retrieval_blocked',
					'Raw fragment retrieval is blocked while field redaction is active',
				);
			}
			const start = Math.max(0, offset || request.start || 0);
			const maximumCharacters = Math.max(1, availableTokens(policy, budgetState) * 3);
			const requestedEnd =
				request.end ??
				(policy.allowFullOriginal ? resource.content.length : start + maximumCharacters);
			let end = Math.min(
				resource.content.length,
				Math.max(start, requestedEnd),
				start + maximumCharacters,
			);
			let candidate: RetrievalResult;
			do {
				const hasMore = end < resource.content.length;
				const path = `chars[${start}:${end}]`;
				candidate = {
					ok: true,
					operation: request.operation,
					resourceId: request.resourceId,
					exact: true,
					path,
					data: resource.content.slice(start, end),
					evidence: evidence(resource, path),
					truncated: hasMore,
					pagination: {
						returned: end - start,
						hasMore,
						...(hasMore
							? { nextCursor: nextCursor(request, resource.manifest.originalHash, end) }
							: {}),
					},
				};
				if (estimateResult(candidate) <= availableTokens(policy, budgetState)) break;
				end = start + Math.floor((end - start) * 0.8);
			} while (end > start);
			result = candidate;
		}

		return finalizeResult(result, request, policy, budgetState);
	} catch (error) {
		return resultError(
			request,
			error instanceof RetrievalPolicyError
				? error.code
				: error instanceof ResourceScopeError
					? 'scope_mismatch'
					: error instanceof Error
						? error.name
						: 'retrieval_error',
			error instanceof Error ? error.message : String(error),
		);
	}
}
