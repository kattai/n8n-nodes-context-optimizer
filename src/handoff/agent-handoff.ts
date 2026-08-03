import { optimizeContent } from '../content/optimize-content';
import { estimateTokens } from '../core/token-estimator';
import type { OptimizerProfileName } from '../core/types';
import { canonicalProfileName } from '../core/profiles';
import { virtualizeContext } from '../virtualization/context-virtualizer';

export interface AgentHandoffInput {
	fromAgent?: string;
	toAgent?: string;
	objective: string;
	confirmedFacts?: unknown;
	decisions?: unknown;
	pendingActions?: unknown;
	resourceIds?: unknown;
	sourceOutput?: unknown;
	profile?: OptimizerProfileName;
}

export interface AgentHandoffResult {
	handoffContext: string;
	receipt: {
		version: 1;
		fromAgent?: string;
		toAgent?: string;
		originalTokens: number;
		handoffTokens: number;
		savedTokens: number;
		savedPercent: number;
		qualityPassed: boolean;
	};
}

function values(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	if (value === undefined || value === null || value === '') return [];
	if (typeof value === 'string') {
		const text = value.trim();
		if (!text) return [];
		try {
			const parsed = JSON.parse(text) as unknown;
			return Array.isArray(parsed) ? parsed : [parsed];
		} catch {
			return text
				.split(/\r?\n/)
				.map((entry) => entry.replace(/^[-*]\s*/, '').trim())
				.filter(Boolean);
		}
	}
	return [value];
}

function exactUnique(value: unknown): unknown[] {
	const seen = new Set<string>();
	return values(value).filter((entry) => {
		const key = typeof entry === 'string' ? entry.trim() : JSON.stringify(entry);
		if (!key || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function sourceText(value: unknown): string {
	if (value === undefined || value === null) return '';
	return typeof value === 'string' ? value : JSON.stringify(value);
}

export function buildAgentHandoff(input: AgentHandoffInput): AgentHandoffResult {
	const objective = String(input.objective ?? '').trim();
	if (!objective) throw new Error('objective is required');
	const source = sourceText(input.sourceOutput);
	const sourceOptimization = optimizeContent(source, {
		contentType: 'auto',
		profile: input.profile ?? 'balanced',
	});
	let sourceSummary =
		sourceOptimization.quality.passed &&
		sourceOptimization.tokens.optimized < sourceOptimization.tokens.original
			? sourceOptimization.optimizedContent
			: source;
	const resourceIds = exactUnique(input.resourceIds).map(String);
	const profile = canonicalProfileName(input.profile ?? 'balanced');
	const primaryResource = resourceIds.find((value) => /^ctx_[a-f0-9]{24}$/.test(value));
	if (primaryResource && profile !== 'quality' && sourceSummary) {
		const preview = virtualizeContext(
			sourceSummary,
			sourceOptimization.contentType,
			primaryResource,
			{
				thresholdTokens: 0,
				maxPreviewTokens: profile === 'savings' ? 500 : 1000,
				maxItems: profile === 'savings' ? 6 : 12,
				currentTask: objective,
				sourceTokens: sourceOptimization.tokens.original,
			},
		);
		if (preview.applied && preview.previewTokens < sourceOptimization.tokens.optimized) {
			sourceSummary = preview.content;
		}
	}
	const context = {
		objective,
		...(input.fromAgent ? { fromAgent: input.fromAgent } : {}),
		...(input.toAgent ? { toAgent: input.toAgent } : {}),
		confirmedFacts: exactUnique(input.confirmedFacts),
		decisions: exactUnique(input.decisions),
		pendingActions: exactUnique(input.pendingActions),
		resourceIds,
		...(sourceSummary ? { sourceOutput: sourceSummary } : {}),
	};
	const handoffContext = JSON.stringify(context);
	const originalTokens = estimateTokens(
		JSON.stringify({
			...context,
			...(source ? { sourceOutput: source } : {}),
		}),
	);
	const handoffTokens = estimateTokens(handoffContext);
	const savedTokens = Math.max(0, originalTokens - handoffTokens);
	return {
		handoffContext,
		receipt: {
			version: 1,
			...(input.fromAgent ? { fromAgent: input.fromAgent } : {}),
			...(input.toAgent ? { toAgent: input.toAgent } : {}),
			originalTokens,
			handoffTokens,
			savedTokens,
			savedPercent:
				originalTokens === 0 ? 0 : Number(((savedTokens / originalTokens) * 100).toFixed(2)),
			qualityPassed: sourceOptimization.quality.passed,
		},
	};
}
