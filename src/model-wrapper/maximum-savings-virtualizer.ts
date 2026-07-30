import type { ContentOptimizationResult, DetectedContentType } from '../content/types';
import { detectContentType } from '../content/content-detector';
import { estimateTokens } from '../core/token-estimator';
import { retrieveContext } from '../retrieval/retrieve-context';
import type { ResourceStore } from '../storage/types';
import { virtualizeContext } from '../virtualization/context-virtualizer';

export type MaximumSavingsFallbackReason =
	| 'content_below_threshold'
	| 'content_type_not_eligible'
	| 'retriever_not_connected'
	| 'secret_like_content'
	| 'store_not_configured'
	| 'storage_error'
	| 'integrity_check_failed'
	| 'retrieval_check_failed'
	| 'preview_budget_failed'
	| 'structural_target_reached';

export interface MaximumSavingsOptions {
	retrieverAvailable: boolean;
	store?: ResourceStore;
	scope: string;
	ttlSeconds: number;
	thresholdTokens: number;
	targetPreviewRatio: number;
	maxPreviewRatio: number;
	allowSecretLikeContent: boolean;
}

export interface MaximumSavingsToolResult {
	content: string;
	eligibleTokensBefore: number;
	eligibleTokensAfter: number;
	eligibleSavingsPercent: number;
	resourceId?: string;
	retrievalRequired: boolean;
	targetBandReached: boolean;
	targetNotReachedReason?: MaximumSavingsFallbackReason;
	storageFallbackUsed: boolean;
}

function percent(before: number, after: number): number {
	if (before === 0) return 0;
	return Number((((before - after) / before) * 100).toFixed(2));
}

function looksBinary(content: string): boolean {
	if (content.includes('\0')) return true;
	const sample = content.slice(0, 8_000);
	if (!sample) return false;
	const controls = [...sample].filter((character) => {
		const code = character.charCodeAt(0);
		return code < 32 && code !== 9 && code !== 10 && code !== 13;
	}).length;
	return controls / sample.length > 0.02;
}

export function containsSecretLikeContent(content: string): boolean {
	return [
		/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
		/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
		/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{12,}/i,
		/["'](?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization)["']\s*:\s*["'][^"']{6,}["']/i,
	].some((pattern) => pattern.test(content));
}

function eligibleType(content: string): DetectedContentType | undefined {
	if (looksBinary(content)) return undefined;
	const detected = detectContentType(content, 'auto');
	if (detected === 'code' || detected === 'html') return undefined;
	if (detected === 'json' || detected === 'logs') return detected;
	return 'rag';
}

function structuralResult(
	result: ContentOptimizationResult,
	reason?: MaximumSavingsFallbackReason,
	storageFallbackUsed = false,
): MaximumSavingsToolResult {
	return {
		content: result.optimizedContent,
		eligibleTokensBefore: result.tokens.original,
		eligibleTokensAfter: result.tokens.optimized,
		eligibleSavingsPercent: result.tokens.savingsPercent,
		retrievalRequired: false,
		targetBandReached: result.tokens.savingsPercent >= 70,
		...(reason ? { targetNotReachedReason: reason } : {}),
		storageFallbackUsed,
	};
}

async function verifyRetrieval(
	store: ResourceStore,
	resourceId: string,
	scope: string,
): Promise<boolean> {
	const result = await retrieveContext(
		store,
		{ operation: 'inspect_schema', resourceId },
		{
			scope,
			maxResults: 1,
			maxTokens: 500,
			allowedFields: [],
			blockedFields: [],
			allowFullOriginal: false,
		},
	);
	return result.ok && result.exact;
}

export async function virtualizeMaximumSavingsToolResult(input: {
	originalContent: string;
	structural: ContentOptimizationResult;
	currentTask: string;
	options: MaximumSavingsOptions;
}): Promise<MaximumSavingsToolResult> {
	const { originalContent, structural, currentTask, options } = input;
	const originalTokens = estimateTokens(originalContent);
	if (structural.tokens.savingsPercent >= 70) {
		return structuralResult(structural, 'structural_target_reached');
	}
	if (originalTokens < options.thresholdTokens) {
		return structuralResult(structural, 'content_below_threshold');
	}
	const contentType = eligibleType(originalContent);
	if (!contentType) {
		return structuralResult(structural, 'content_type_not_eligible');
	}
	if (!options.retrieverAvailable) {
		return structuralResult(structural, 'retriever_not_connected', true);
	}
	if (!options.allowSecretLikeContent && containsSecretLikeContent(originalContent)) {
		return structuralResult(structural, 'secret_like_content', true);
	}
	if (!options.store) {
		return structuralResult(structural, 'store_not_configured', true);
	}

	let resourceId: string | undefined;
	try {
		const manifest = await options.store.store({
			content: originalContent,
			contentType,
			ttlSeconds: options.ttlSeconds,
			scope: options.scope,
			recordCount: structural.manifest.recordCount,
			fields: structural.manifest.fields,
		});
		resourceId = manifest.resourceId;
		const stored = await options.store.read(resourceId);
		if (stored.content !== originalContent || stored.manifest.scope !== options.scope) {
			await options.store.delete(resourceId).catch(() => undefined);
			return structuralResult(structural, 'integrity_check_failed', true);
		}
		if (!(await verifyRetrieval(options.store, resourceId, options.scope))) {
			await options.store.delete(resourceId).catch(() => undefined);
			return structuralResult(structural, 'retrieval_check_failed', true);
		}

		const targetRatio = Math.min(
			Math.max(options.targetPreviewRatio, 0.05),
			Math.min(Math.max(options.maxPreviewRatio, 0.05), 0.3),
		);
		const maximumPreviewTokens = Math.max(100, Math.floor(originalTokens * targetRatio));
		const virtualized = virtualizeContext(
			structural.optimizedContent,
			contentType,
			resourceId,
			{
				thresholdTokens: 0,
				maxPreviewTokens: maximumPreviewTokens,
				maxItems: 1000,
				currentTask,
				recordCount: structural.manifest.recordCount,
				fields: structural.manifest.fields,
				sourceTokens: originalTokens,
			},
		);
		const maximumAllowed = Math.floor(
			originalTokens * Math.min(Math.max(options.maxPreviewRatio, 0.05), 0.3),
		);
		if (
			!virtualized.applied ||
			virtualized.previewTokens >= structural.tokens.optimized ||
			virtualized.previewTokens > maximumAllowed
		) {
			await options.store.delete(resourceId).catch(() => undefined);
			return structuralResult(structural, 'preview_budget_failed', true);
		}

		const savings = percent(originalTokens, virtualized.previewTokens);
		return {
			content: virtualized.content,
			eligibleTokensBefore: originalTokens,
			eligibleTokensAfter: virtualized.previewTokens,
			eligibleSavingsPercent: savings,
			resourceId,
			retrievalRequired: true,
			targetBandReached: savings >= 70,
			storageFallbackUsed: false,
		};
	} catch {
		if (resourceId && options.store) {
			await options.store.delete(resourceId).catch(() => undefined);
		}
		return structuralResult(structural, 'storage_error', true);
	}
}
