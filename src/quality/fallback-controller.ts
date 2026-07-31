import { estimateTokens } from '../core/token-estimator';
import { calculateNetSavings } from '../tokens/token-counter';
import type { ContentManifest, ContentQuality } from '../content/types';
import { checkContentQuality } from './quality-guard';
import type { QualityVerificationLevel } from './verification-policy';

export interface QualityFallbackCandidate<T> {
	name: string;
	value: T;
	content: string;
	manifest: ContentManifest;
	eligible?: boolean;
	rejectionReason?: string;
}

export interface QualityFallbackResult<T> {
	selected: QualityFallbackCandidate<T>;
	quality: ContentQuality;
	fallbackUsed: boolean;
	attempted: string[];
	warnings: string[];
}

export function selectQualityFallback<T>(input: {
	original: QualityFallbackCandidate<T>;
	candidates: Array<QualityFallbackCandidate<T>>;
	protectedValues?: string[] | string;
	level?: QualityVerificationLevel;
	compressorTokens?: number;
	verificationTokens?: number;
	minimumNetSavingsTokens?: number;
}): QualityFallbackResult<T> {
	const attempted: string[] = [];
	const warnings: string[] = [];
	const originalTokens = estimateTokens(input.original.content);

	for (const candidate of input.candidates) {
		attempted.push(candidate.name);
		if (candidate.eligible === false) {
			warnings.push(`${candidate.name}: ${candidate.rejectionReason ?? 'candidate_rejected'}`);
			continue;
		}
		const quality = checkContentQuality(
			input.original.content,
			candidate.content,
			candidate.manifest,
			input.protectedValues,
			input.level,
		);
		if (!quality.passed) {
			warnings.push(`${candidate.name}: ${quality.warnings.join(', ')}`);
			continue;
		}
		const net = calculateNetSavings({
			originalTokens,
			sentTokens: estimateTokens(candidate.content),
			compressorTokens: input.compressorTokens,
			verificationTokens: input.verificationTokens,
			minimumNetSavingsTokens: input.minimumNetSavingsTokens,
		});
		if (!net.useOptimized) {
			warnings.push(`${candidate.name}: ${net.reason ?? 'negative_net_savings'}`);
			continue;
		}
		return {
			selected: candidate,
			quality,
			fallbackUsed: candidate.name !== input.candidates[0]?.name,
			attempted,
			warnings,
		};
	}

	const quality = checkContentQuality(
		input.original.content,
		input.original.content,
		input.original.manifest,
		input.protectedValues,
		input.level,
	);
	return {
		selected: input.original,
		quality: {
			...quality,
			fallbackUsed: true,
			fallbackReason:
				warnings[warnings.length - 1]?.split(': ').slice(1).join(': ') || 'original_required',
		},
		fallbackUsed: true,
		attempted: [...attempted, input.original.name],
		warnings,
	};
}
