import type { ContentOptimizationResult } from '../content/types';
import type { OptimizeContextResult } from '../core/types';
import type { RetrievalResult } from '../retrieval/retrieve-context';
import type { ResourceManifest } from '../storage/types';
import type { RunComparison, TokenAnalysis } from '../analytics/token-analytics';

export type OutputDetail = 'simple' | 'detailed';

export interface TokenSavingsSummary {
	before: number;
	after: number;
	saved: number;
	percent: number;
	measurement: 'provider' | 'estimated' | 'unavailable';
	qualityPassed: boolean;
	fallbackReason?: string;
}

function percent(saved: number, before: number): number {
	return before === 0 ? 0 : Number(((saved / before) * 100).toFixed(2));
}

function contentSavings(result: ContentOptimizationResult): TokenSavingsSummary {
	return {
		before: result.tokens.original,
		after: result.tokens.optimized,
		saved: result.tokens.saved,
		percent: result.tokens.savingsPercent,
		measurement: 'estimated',
		qualityPassed: result.quality.passed,
		...(result.quality.fallbackReason ? { fallbackReason: result.quality.fallbackReason } : {}),
	};
}

export function contentOutput(
	operation: 'compileStaticPrompt' | 'optimizeContent',
	result: ContentOptimizationResult,
	virtualization: Record<string, unknown>,
	outputDetail: OutputDetail,
): Record<string, unknown> {
	const base: Record<string, unknown> = {
		...(operation === 'compileStaticPrompt'
			? {
					optimizedPrompt: result.optimizedContent,
					promptCacheKey: result.manifest.originalHash,
				}
			: { optimizedContent: result.optimizedContent }),
		tokenSavings: contentSavings(result),
	};
	if (virtualization.applied === true && typeof virtualization.resourceId === 'string') {
		base.contextResource = {
			resourceId: virtualization.resourceId,
			...(typeof virtualization.expiresAt === 'string'
				? { expiresAt: virtualization.expiresAt }
				: {}),
		};
	}
	if (outputDetail === 'detailed') {
		base.contentOptimization = result;
		base.contextVirtualization = virtualization;
	}
	return base;
}

export function contextOutput(
	result: OptimizeContextResult,
	outputDetail: OutputDetail,
): Record<string, unknown> {
	const tokenSavings: TokenSavingsSummary = {
		before: result.optimization.tokensBefore,
		after: result.optimization.tokensAfter,
		saved: result.optimization.savingsTokens,
		percent: result.optimization.savingsPercent,
		measurement: 'estimated',
		qualityPassed: !result.optimization.fallback,
		...(result.optimization.fallbackReason
			? { fallbackReason: result.optimization.fallbackReason }
			: {}),
	};
	return outputDetail === 'detailed'
		? { ...result, tokenSavings }
		: {
				optimizedContext: result.optimizedContext,
				currentMessage: result.currentMessage,
				tokenSavings,
			};
}

export function storeReceipt(manifest: ResourceManifest): Record<string, unknown> {
	return {
		stored: true,
		resourceId: manifest.resourceId,
		contentType: manifest.contentType,
		expiresAt: manifest.expiresAt,
		...(manifest.recordCount !== undefined ? { recordCount: manifest.recordCount } : {}),
		...(manifest.fields && manifest.fields.length > 0 ? { fields: manifest.fields } : {}),
	};
}

export function inspectReceipt(manifest: ResourceManifest): Record<string, unknown> {
	const receipt = storeReceipt(manifest);
	delete receipt.stored;
	return receipt;
}

export function compactRetrievalResult(result: RetrievalResult): Record<string, unknown> {
	if (!result.ok) {
		return {
			ok: false,
			error: result.error,
			source: { resourceId: result.resourceId },
		};
	}
	return {
		ok: true,
		data: result.data,
		source: {
			resourceId: result.evidence?.resourceId ?? result.resourceId,
			...(result.evidence?.path || result.path
				? { path: result.evidence?.path ?? result.path }
				: {}),
			...(result.evidence?.hash ? { hash: result.evidence.hash } : {}),
			exact: result.evidence?.exact ?? result.exact,
		},
		...(result.pagination ? { page: result.pagination } : {}),
		...(result.truncated ? { truncated: true } : {}),
		...(result.redacted ? { redacted: true } : {}),
		...(result.tokensEstimated !== undefined ? { tokens: result.tokensEstimated } : {}),
	};
}

export function analysisOutput(analysis: TokenAnalysis): Record<string, unknown> {
	const before = analysis.measurement.original;
	const after = analysis.actual.available ? analysis.actual.inputTokens : analysis.measurement.sent;
	const saved =
		before -
		after -
		analysis.measurement.compressor -
		analysis.measurement.retrieved -
		analysis.measurement.verifier;
	return {
		tokenSavings: {
			before,
			after,
			saved,
			percent: percent(saved, before),
			measurement: analysis.actual.available ? 'provider' : 'estimated',
			qualityPassed: analysis.measurement.qualityGuardFailures === 0,
		} satisfies TokenSavingsSummary,
		tokenUsage: {
			inputSent: after,
			regularInput: analysis.actual.regularInputTokens,
			cachedInput: analysis.actual.cachedInputTokens,
			output: analysis.actual.available
				? analysis.actual.outputTokens
				: analysis.measurement.output,
			reasoning: analysis.actual.reasoningTokens,
			retrieved: analysis.measurement.retrieved,
			cache: analysis.actual.available
				? analysis.actual.cacheUsageAvailable
					? 'measured'
					: 'unknown'
				: 'not_reported',
		},
		measurementConfidence: analysis.measurementConfidence,
		...(analysis.measurement.cacheStrategy
			? {
					cacheOptimization: {
						strategy: analysis.measurement.cacheStrategy,
						decision: analysis.measurement.cacheDecision ?? 'unknown',
						stablePrefix: analysis.measurement.stablePrefixTokens,
						dynamicBefore: analysis.measurement.dynamicTokensBefore,
						dynamicAfter: analysis.measurement.dynamicTokensAfter,
					},
				}
			: {}),
		...(analysis.cost ? { cost: analysis.cost } : {}),
	};
}

export function modelComparisonOutput(
	comparison: RunComparison,
	baselineInput?: number,
	optimizedInput?: number,
): Record<string, unknown> {
	const provider = comparison.delta.inputTokenBasis === 'provider-actual';
	const before =
		baselineInput ??
		(provider ? comparison.baseline.actual.inputTokens : comparison.baseline.measurement.sent);
	const after =
		optimizedInput ??
		(provider ? comparison.optimized.actual.inputTokens : comparison.optimized.measurement.sent);
	const saved = before - after;
	return {
		tokenSavings: {
			before,
			after,
			saved,
			percent: percent(saved, before),
			measurement: provider ? 'provider' : 'estimated',
			qualityPassed: comparison.delta.qualityGuardFailures <= 0,
		} satisfies TokenSavingsSummary,
	};
}
