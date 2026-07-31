import { createHash } from 'node:crypto';
import { estimateTokens } from '../core/token-estimator';
import { checkContentQuality } from '../quality/quality-guard';
import { detectContentType } from './content-detector';
import { compressHtml, removeHtmlBoilerplate } from './html-compressor';
import { compressJson } from './json-compressor';
import { compressLogs } from './log-compressor';
import { compressRag } from './rag-compressor';
import { compressText } from './text-compressor';
import type {
	CompressorResult,
	ContentManifest,
	ContentOptimizationOptions,
	ContentOptimizationResult,
	DetectedContentType,
} from './types';

function compress(
	content: string,
	type: DetectedContentType,
	options: ContentOptimizationOptions,
): CompressorResult {
	if (type === 'json') return compressJson(content, options);
	if (type === 'tool_output') {
		try {
			const result = compressJson(content, options);
			return {
				...result,
				strategies: ['tool-output-json', ...result.strategies],
			};
		} catch {
			return compressRag(content);
		}
	}
	if (type === 'logs') return compressLogs(content);
	if (type === 'html') return compressHtml(content);
	if (type === 'rag') return compressRag(content);
	if (type === 'code') {
		return {
			content,
			strategies: ['preserve-code'],
			format: 'text',
		};
	}
	return compressText(content);
}

function tokenMetrics(original: string, optimized: string) {
	const originalTokens = estimateTokens(original);
	const optimizedTokens = estimateTokens(optimized);
	const saved = Math.max(0, originalTokens - optimizedTokens);
	return {
		original: originalTokens,
		optimized: optimizedTokens,
		saved,
		savingsPercent: originalTokens === 0 ? 0 : Number(((saved / originalTokens) * 100).toFixed(2)),
		areEstimated: true as const,
	};
}

export function optimizeContent(
	content: string,
	options: ContentOptimizationOptions = {},
): ContentOptimizationResult {
	const contentType = detectContentType(content, options.contentType);
	let compressed: CompressorResult;
	try {
		compressed = compress(content, contentType, options);
	} catch {
		compressed = {
			content,
			strategies: ['fallback-original'],
			format: 'text',
		};
	}
	const manifest: ContentManifest = {
		contentType,
		originalHash: createHash('sha256').update(content).digest('hex'),
		originalBytes: Buffer.byteLength(content),
		optimizedBytes: Buffer.byteLength(compressed.content),
		recordCount: compressed.recordCount,
		fields: compressed.fields,
		format: compressed.format,
		roundTripVerified: compressed.roundTripVerified,
	};
	const quality = checkContentQuality(
		contentType === 'html' ? removeHtmlBoilerplate(content) : content,
		compressed.content,
		manifest,
		options.protectedValues,
		options.qualityLevel,
	);
	const compressedTokens = tokenMetrics(content, compressed.content);
	const noPositiveSavings =
		!compressed.strategies.includes('preserve-code') &&
		compressedTokens.optimized >= compressedTokens.original;
	const optimizedContent = quality.passed && !noPositiveSavings ? compressed.content : content;
	const finalQuality = noPositiveSavings
		? {
				...quality,
				warnings: [...quality.warnings, 'no-positive-savings'],
				fallbackUsed: true,
				fallbackReason: 'no_positive_savings',
			}
		: quality;
	return {
		optimizedContent,
		contentType,
		strategies:
			quality.passed && !noPositiveSavings ? compressed.strategies : ['fallback-original'],
		tokens: tokenMetrics(content, optimizedContent),
		quality: finalQuality,
		manifest: {
			...manifest,
			optimizedBytes: Buffer.byteLength(optimizedContent),
		},
	};
}
