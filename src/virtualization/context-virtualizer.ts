import { estimateTokens } from '../core/token-estimator';
import type { DetectedContentType } from '../content/types';

export interface ContextVirtualizationOptions {
	thresholdTokens: number;
	maxPreviewTokens: number;
	maxItems: number;
	currentTask?: string;
	recordCount?: number;
	fields?: string[];
	sourceTokens?: number;
}

export interface ContextVirtualizationResult {
	applied: boolean;
	content: string;
	resourceId: string;
	originalTokens: number;
	previewTokens: number;
	totalItems: number;
	selectedItems: number;
	selection: 'none' | 'task-aware-lexical' | 'leading-items';
	exactRetrievalRequired: boolean;
}

interface Candidate {
	index: number;
	path: string;
	content: string;
	score: number;
}

function normalize(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();
}

function terms(value: string): string[] {
	return [...new Set(normalize(value).match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])];
}

function score(value: string, query: string[]): number {
	const normalized = normalize(value);
	return query.reduce(
		(total, term) =>
			total +
			(normalized.includes(term) ? Math.min(6, Math.max(1, Math.ceil(term.length / 3))) : 0),
		0,
	);
}

function fixedChunks(value: string, size = 1200): string[] {
	const chunks: string[] = [];
	for (let index = 0; index < value.length; index += size) {
		chunks.push(value.slice(index, index + size));
	}
	return chunks;
}

function contentCandidates(
	content: string,
	type: DetectedContentType,
	query: string[],
): { candidates: Candidate[]; prefix: string[] } {
	if (content.startsWith('@json-table\n')) {
		const lines = content.split('\n');
		const fieldsIndex = lines.findIndex((line) => line.startsWith('fields:'));
		const prefixLength = fieldsIndex >= 0 ? fieldsIndex + 1 : 2;
		return {
			prefix: lines.slice(0, prefixLength),
			candidates: lines.slice(prefixLength).map((line, index) => ({
				index,
				path: `[${index}]`,
				content: line,
				score: score(line, query),
			})),
		};
	}

	const sections =
		type === 'logs'
			? content.split('\n').filter(Boolean)
			: content.split(/\n{2,}/).filter((section) => section.trim());
	const chunks = sections.length > 1 ? sections : fixedChunks(content);
	return {
		prefix: [],
		candidates: chunks.map((chunk, index) => ({
			index,
			path: `section[${index}]`,
			content: chunk.trim(),
			score: score(chunk, query),
		})),
	};
}

function escapeAttribute(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapePreview(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function receipt(
	resourceId: string,
	type: DetectedContentType,
	options: ContextVirtualizationOptions,
	originalTokens: number,
	totalItems: number,
	selectedItems: number,
	preview: string,
): string {
	const attributes = [
		`id="${escapeAttribute(resourceId)}"`,
		`type="${type}"`,
		`original_tokens="${originalTokens}"`,
		options.recordCount !== undefined ? `record_count="${options.recordCount}"` : '',
		'exact_retrieval="required"',
	]
		.filter(Boolean)
		.join(' ');
	return [
		`<context-resource ${attributes}>`,
		'<untrusted-preview>',
		escapePreview(preview),
		'</untrusted-preview>',
		`Use retrieve_context(resourceId="${resourceId}") for exact/missing data. Never infer omitted values.`,
		'</context-resource>',
	].join('\n');
}

export function virtualizeContext(
	content: string,
	type: DetectedContentType,
	resourceId: string,
	options: ContextVirtualizationOptions,
): ContextVirtualizationResult {
	const originalTokens = estimateTokens(content);
	const sourceTokens = options.sourceTokens ?? originalTokens;
	if (originalTokens <= options.thresholdTokens) {
		return {
			applied: false,
			content,
			resourceId,
			originalTokens: sourceTokens,
			previewTokens: originalTokens,
			totalItems: 0,
			selectedItems: 0,
			selection: 'none',
			exactRetrievalRequired: false,
		};
	}

	const query = terms(options.currentTask ?? '');
	const { candidates, prefix } = contentCandidates(content, type, query);
	const ordered =
		query.length > 0
			? [...candidates].sort((left, right) => right.score - left.score || left.index - right.index)
			: candidates;
	const selected: Candidate[] = [];
	let includedPrefix: string[] = [];
	const emptyReceipt = receipt(
		resourceId,
		type,
		options,
		sourceTokens,
		candidates.length,
		0,
		'',
	);
	if (estimateTokens(emptyReceipt) > options.maxPreviewTokens) {
		return {
			applied: false,
			content,
			resourceId,
			originalTokens: sourceTokens,
			previewTokens: originalTokens,
			totalItems: candidates.length,
			selectedItems: 0,
			selection: 'none',
			exactRetrievalRequired: false,
		};
	}
	if (prefix.length > 0) {
		const withPrefix = receipt(
			resourceId,
			type,
			options,
			sourceTokens,
			candidates.length,
			0,
			prefix.join('\n'),
		);
		if (estimateTokens(withPrefix) <= options.maxPreviewTokens) {
			includedPrefix = prefix;
		}
	}
	for (const candidate of ordered) {
		if (selected.length >= Math.max(1, options.maxItems)) break;
		const trial = [...selected, candidate].sort((left, right) => left.index - right.index);
		const trialPreview = [
			...includedPrefix,
			...trial.map((entry) =>
				includedPrefix.length > 0
					? entry.content
					: `<preview path="${entry.path}">\n${entry.content}\n</preview>`,
			),
		].join('\n');
		const trialReceipt = receipt(
			resourceId,
			type,
			options,
			sourceTokens,
			candidates.length,
			trial.length,
			trialPreview,
		);
		if (estimateTokens(trialReceipt) > options.maxPreviewTokens) continue;
		selected.push(candidate);
	}
	selected.sort((left, right) => left.index - right.index);

	const previewParts = [
		...includedPrefix,
		...selected.map((candidate) =>
			includedPrefix.length > 0
				? candidate.content
				: `<preview path="${candidate.path}">\n${candidate.content}\n</preview>`,
		),
	];
	const contentWithReceipt = receipt(
		resourceId,
		type,
		options,
		sourceTokens,
		candidates.length,
		selected.length,
		previewParts.join('\n'),
	);
	return {
		applied: true,
		content: contentWithReceipt,
		resourceId,
		originalTokens: sourceTokens,
		previewTokens: estimateTokens(contentWithReceipt),
		totalItems: candidates.length,
		selectedItems: selected.length,
		selection: query.length > 0 ? 'task-aware-lexical' : 'leading-items',
		exactRetrievalRequired: true,
	};
}
