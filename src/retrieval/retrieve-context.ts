/* eslint-disable @n8n/community-nodes/require-node-api-error -- Retrieval core has no n8n execution context; the tool adapter returns structured errors. */
import { estimateTokens } from '../core/token-estimator';
import type { ResourceStore, StoredResource } from '../storage/types';

export type RetrievalOperation =
	| 'search_context'
	| 'filter_records'
	| 'get_exact_value'
	| 'get_section'
	| 'inspect_schema'
	| 'get_original_fragment';

export interface RetrievalRequest {
	operation: RetrievalOperation;
	resourceId: string;
	query?: string;
	path?: string;
	filters?: Record<string, string | number | boolean | null>;
	fields?: string[];
	limit?: number;
	section?: number;
	start?: number;
	end?: number;
}

export interface RetrievalPolicy {
	scope: string;
	maxResults: number;
	maxTokens: number;
	allowedFields: string[];
	blockedFields: string[];
	allowFullOriginal: boolean;
}

export interface RetrievalResult {
	ok: boolean;
	operation: RetrievalOperation;
	resourceId: string;
	exact: boolean;
	data?: unknown;
	path?: string;
	redacted?: boolean;
	truncated?: boolean;
	tokensEstimated?: number;
	error?: {
		code: string;
		message: string;
	};
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

function queryTerms(query: string): string[] {
	return [...new Set(normalize(query).match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])];
}

function score(value: string, terms: string[]): number {
	const normalized = normalize(value);
	return terms.reduce((total, term) => total + (normalized.includes(term) ? 1 : 0), 0);
}

function parsePath(path: string): Array<string | number> {
	if (!path.trim()) return [];
	const parts: Array<string | number> = [];
	const pattern = /(?:^|\.)([A-Za-z_$][\w$-]*)|\[(\d+)\]/g;
	let match: RegExpExecArray | null;
	let consumed = '';
	while ((match = pattern.exec(path)) !== null) {
		const raw = match[0];
		consumed += raw;
		const part = match[1] ?? Number(match[2]);
		if (typeof part === 'string' && blockedPathParts.has(part)) {
			throw new Error('Blocked path segment');
		}
		parts.push(part);
	}
	if (consumed !== path) throw new Error('Invalid path');
	return parts;
}

function valueAtPath(root: unknown, path: string): unknown {
	let value = root;
	for (const part of parsePath(path)) {
		if (value === null || value === undefined || typeof value !== 'object') {
			return undefined;
		}
		value = (value as Record<string | number, unknown>)[part];
	}
	return value;
}

function policyFields(values: string[]): Set<string> {
	return new Set(values.map(normalize));
}

function fieldAllowed(field: string, policy: RetrievalPolicy): boolean {
	const normalized = normalize(field);
	if (policyFields(policy.blockedFields).has(normalized)) return false;
	return policy.allowedFields.length === 0 || policyFields(policy.allowedFields).has(normalized);
}

function enforceField(path: string, policy: RetrievalPolicy): void {
	const fields = parsePath(path).filter((part): part is string => typeof part === 'string');
	const blocked = policyFields(policy.blockedFields);
	const blockedField = fields.find((field) => blocked.has(normalize(field)));
	if (blockedField) {
		throw new RetrievalPolicyError(
			'field_not_allowed',
			`Field is not allowed: ${blockedField}`,
		);
	}
	const leaf = fields[fields.length - 1];
	if (leaf && policy.allowedFields.length > 0 && !fieldAllowed(leaf, policy)) {
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
): SanitizedValue {
	const allowed = policyFields(policy.allowedFields);
	const blocked = policyFields(policy.blockedFields);
	const restricted = allowed.size > 0;
	if (Array.isArray(value)) {
		let redacted = false;
		const result: unknown[] = [];
		for (const entry of value) {
			const sanitized = sanitizeValue(entry, policy, ancestorAllowed);
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
		const keyAllowed = ancestorAllowed || allowed.has(normalizedKey);
		const sanitized = sanitizeValue(entry, policy, keyAllowed);
		redacted ||= sanitized.redacted;
		if (!restricted || keyAllowed || sanitized.included) {
			result[key] = sanitized.value;
		} else {
			redacted = true;
		}
	}
	return {
		value: result,
		redacted,
		included: !restricted || ancestorAllowed || Object.keys(result).length > 0,
	};
}

function capResult(
	result: RetrievalResult,
	policy: RetrievalPolicy,
): RetrievalResult {
	const serialized = JSON.stringify(result.data ?? null);
	const tokens = estimateTokens(serialized);
	if (tokens <= policy.maxTokens) {
		return { ...result, tokensEstimated: tokens };
	}
	if (result.exact) {
		return {
			ok: false,
			operation: result.operation,
			resourceId: result.resourceId,
			exact: false,
			error: {
				code: 'retrieval_budget_exceeded',
				message: `Exact result exceeds ${policy.maxTokens} tokens`,
			},
		};
	}
	const maximumCharacters = Math.max(1, policy.maxTokens * 4);
	return {
		...result,
		data: serialized.slice(0, maximumCharacters),
		truncated: true,
		tokensEstimated: policy.maxTokens,
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

function selectFields(
	record: unknown,
	fields: string[],
	policy: RetrievalPolicy,
): SanitizedValue {
	if (!record || typeof record !== 'object' || Array.isArray(record)) {
		return sanitizeValue(record, policy);
	}
	const source = record as Record<string, unknown>;
	if (fields.length === 0) return sanitizeValue(source, policy);
	const selected =
		fields.length > 0 ? fields : Object.keys(source);
	const value: Record<string, unknown> = {};
	let redacted = false;
	for (const field of selected) {
		enforceField(field, policy);
		const sourceValue = valueAtPath(source, field);
		const sanitized = sanitizeValue(sourceValue, policy, true);
		redacted ||= sanitized.redacted;
		if (sanitized.included) value[field] = sanitized.value;
	}
	return { value, redacted, included: true };
}

function matchesFilters(
	record: unknown,
	filters: Record<string, string | number | boolean | null>,
	policy: RetrievalPolicy,
): boolean {
	if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
	return Object.entries(filters).every(([path, expected]) => {
		enforceField(path, policy);
		return valueAtPath(record, path) === expected;
	});
}

function searchChunks(
	resource: StoredResource,
	query: string,
	limit: number,
	policy: RetrievalPolicy,
): {
	results: Array<{ path: string; score: number; content: unknown }>;
	redacted: boolean;
} {
	const terms = queryTerms(query);
	let chunks: Array<{ path: string; content: unknown }>;
	let redacted = false;
	try {
		const parsed = JSON.parse(resource.content) as unknown;
		if (Array.isArray(parsed)) {
			chunks = parsed.map((content, index) => {
				const sanitized = sanitizeValue(content, policy);
				redacted ||= sanitized.redacted;
				return { path: `[${index}]`, content: sanitized.value };
			});
		} else {
			chunks = Object.entries(parsed as Record<string, unknown>).map(([path, content]) => {
				const sanitized = sanitizeValue({ [path]: content }, policy);
				redacted ||= sanitized.redacted;
				return { path, content: sanitized.value };
			});
		}
	} catch {
		if (policy.blockedFields.length > 0 || policy.allowedFields.length > 0) {
			throw new RetrievalPolicyError(
				'raw_retrieval_blocked',
				'Raw text search is blocked while field redaction is active',
			);
		}
		chunks = resource.content
			.split(/\n{2,}/)
			.map((content, index) => ({ path: `section[${index}]`, content: content.trim() }))
			.filter((entry) => entry.content);
	}
	return {
		results: chunks
		.map((chunk) => ({
			...chunk,
			score: score(JSON.stringify(chunk.content), terms),
		}))
		.filter((chunk) => terms.length === 0 || chunk.score > 0)
		.sort((left, right) => right.score - left.score)
		.slice(0, limit),
		redacted,
	};
}

function resultError(
	request: RetrievalRequest,
	code: string,
	message: string,
): RetrievalResult {
	return {
		ok: false,
		operation: request.operation,
		resourceId: request.resourceId,
		exact: false,
		error: { code, message },
	};
}

export async function retrieveContext(
	store: ResourceStore,
	request: RetrievalRequest,
	policy: RetrievalPolicy,
): Promise<RetrievalResult> {
	try {
		const resource = await store.read(request.resourceId);
		if (resource.manifest.scope !== policy.scope) {
			return resultError(request, 'scope_mismatch', 'Resource belongs to a different scope');
		}
		const limit = Math.max(
			1,
			Math.min(request.limit ?? policy.maxResults, policy.maxResults),
		);
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
				redacted: fields.length !== (resource.manifest.fields ?? []).length,
			};
		} else if (request.operation === 'get_exact_value') {
			const path = request.path ?? '';
			enforceField(path, policy);
			const value = valueAtPath(parseJson(resource.content), path);
			if (value === undefined) {
				return resultError(request, 'path_not_found', `Path not found: ${path}`);
			}
			const pathFields = parsePath(path).filter(
				(part): part is string => typeof part === 'string',
			);
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
				redacted: sanitized.redacted,
			};
		} else if (request.operation === 'filter_records') {
			const path = request.path ?? '';
			if (path) enforceField(path, policy);
			const fields = (request.fields ?? []).filter((field) => {
				enforceField(field, policy);
				return true;
			});
			let redacted = false;
			const records = recordsAtPath(resource.content, path)
				.filter((record) => matchesFilters(record, request.filters ?? {}, policy))
				.slice(0, limit)
				.map((record) => {
					const selected = selectFields(record, fields, policy);
					redacted ||= selected.redacted;
					return selected.value;
				});
			result = {
				ok: true,
				operation: request.operation,
				resourceId: request.resourceId,
				exact: true,
				path,
				data: { count: records.length, records },
				redacted,
			};
		} else if (request.operation === 'search_context') {
			const search = searchChunks(resource, request.query ?? '', limit, policy);
			result = {
				ok: true,
				operation: request.operation,
				resourceId: request.resourceId,
				exact: true,
				data: { count: search.results.length, results: search.results },
				redacted: search.redacted,
			};
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
			if (section >= sections.length) {
				return resultError(request, 'section_not_found', `Section not found: ${section}`);
			}
			result = {
				ok: true,
				operation: request.operation,
				resourceId: request.resourceId,
				exact: true,
				path: `section[${section}]`,
				data: sections[section],
			};
		} else {
			if (policy.blockedFields.length > 0 || policy.allowedFields.length > 0) {
				return resultError(
					request,
					'raw_retrieval_blocked',
					'Raw fragment retrieval is blocked while field redaction is active',
				);
			}
			const start = Math.max(0, request.start ?? 0);
			const maximumCharacters = policy.maxTokens * 4;
			const requestedEnd =
				request.end ??
				(policy.allowFullOriginal ? resource.content.length : start + maximumCharacters);
			const end = Math.min(
				resource.content.length,
				Math.max(start, requestedEnd),
				start + maximumCharacters,
			);
			result = {
				ok: true,
				operation: request.operation,
				resourceId: request.resourceId,
				exact: true,
				path: `chars[${start}:${end}]`,
				data: resource.content.slice(start, end),
				truncated: end < resource.content.length,
			};
		}

		return capResult(result, policy);
	} catch (error) {
		return resultError(
			request,
			error instanceof RetrievalPolicyError
				? error.code
				: error instanceof Error
					? error.name
					: 'retrieval_error',
			error instanceof Error ? error.message : String(error),
		);
	}
}
