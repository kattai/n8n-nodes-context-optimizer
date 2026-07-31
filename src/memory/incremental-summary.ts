import { contextHash } from '../context/canonical-context';
import type { IncrementalSummary } from './types';

export interface SummaryUpdateResult {
	summary?: IncrementalSummary;
	warning?: 'summary_rejected_empty' | 'summary_rejected_oversize' | 'summary_rejected_stale';
}

export function validateIncrementalSummary(
	candidate: string,
	currentRevision: number,
	now: string,
	basedOnRevision?: number,
): SummaryUpdateResult {
	const text = candidate.trim();
	if (!text) return { warning: 'summary_rejected_empty' };
	if (Buffer.byteLength(text, 'utf8') > 64 * 1024) {
		return { warning: 'summary_rejected_oversize' };
	}
	if (basedOnRevision !== undefined && basedOnRevision !== currentRevision) {
		return { warning: 'summary_rejected_stale' };
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
