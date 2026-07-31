import { contextHash } from '../context/canonical-context';
import { estimateTokens } from '../core/token-estimator';
import type { IncrementalSummary } from './types';

export interface SummaryUpdateResult {
	summary?: IncrementalSummary;
	warning?:
		| 'summary_rejected_empty'
		| 'summary_rejected_missing_required_value'
		| 'summary_rejected_oversize'
		| 'summary_rejected_stale';
}

export function validateIncrementalSummary(
	candidate: string,
	currentRevision: number,
	now: string,
	basedOnRevision?: number,
	requiredValues: string[] = [],
	maximumTokens = 4_000,
): SummaryUpdateResult {
	const text = candidate.trim();
	if (!text) return { warning: 'summary_rejected_empty' };
	if (Buffer.byteLength(text, 'utf8') > 64 * 1024 || estimateTokens(text) > maximumTokens) {
		return { warning: 'summary_rejected_oversize' };
	}
	if (basedOnRevision !== undefined && basedOnRevision !== currentRevision) {
		return { warning: 'summary_rejected_stale' };
	}
	if (requiredValues.some((value) => value.trim() && !text.includes(value.trim()))) {
		return { warning: 'summary_rejected_missing_required_value' };
	}
	return {
		summary: {
			text,
			hash: contextHash(text),
			basedOnRevision: currentRevision,
			updatedAt: now,
		},
	};
}
