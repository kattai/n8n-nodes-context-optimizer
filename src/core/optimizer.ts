import { compressHistory, compressSection } from './deterministic-compressor';
import { normalizeSection, splitUnits } from './normalize';
import { resolveProfile } from './profiles';
import { extractProtectedFacts, validateProtectedFacts } from './protected-facts';
import { estimateSections, estimateTokens } from './token-estimator';
import { calculateNetSavings } from '../tokens/token-counter';
import type {
	FallbackReason,
	OptimizeContextInput,
	OptimizeContextOptions,
	OptimizeContextResult,
	ResolvedProfile,
	SummaryAdapter,
} from './types';

interface NormalizedInput {
	systemPrompt: string;
	history: string;
	retrievedContext: string;
	toolDefinitions: string;
	currentMessage: string;
}

interface BudgetResult {
	context: NormalizedInput;
	trimmed: boolean;
	budgetMet: boolean;
}

function normalizeInput(input: OptimizeContextInput): NormalizedInput {
	return {
		systemPrompt: normalizeSection(input.systemPrompt),
		history: normalizeSection(input.conversationHistory),
		retrievedContext: normalizeSection(input.retrievedContext),
		toolDefinitions: normalizeSection(input.toolDefinitions),
		currentMessage: input.currentMessage,
	};
}

function combined(input: NormalizedInput): string {
	return [
		input.systemPrompt,
		input.history,
		input.retrievedContext,
		input.toolDefinitions,
		input.currentMessage,
	]
		.filter(Boolean)
		.join('\n\n');
}

function enforceTokenBudget(
	input: NormalizedInput,
	maxTokens: number,
	facts: string[],
): BudgetResult {
	if (estimateSections(Object.values(input)) <= maxTokens) {
		return { context: input, trimmed: false, budgetMet: true };
	}

	type Candidate = {
		source: 'history' | 'retrievedContext';
		index: number;
		text: string;
		required: boolean;
	};
	const history = splitUnits(input.history);
	const retrievedContext = splitUnits(input.retrievedContext);
	const candidates: Candidate[] = [
		...history.map((text, index) => ({
			source: 'history' as const,
			index,
			text,
			required: facts.some((fact) => text.includes(fact)),
		})),
		...retrievedContext.map((text, index) => ({
			source: 'retrievedContext' as const,
			index,
			text,
			required: facts.some((fact) => text.includes(fact)),
		})),
	];
	const selected = new Map<string, Candidate>();
	const build = (): NormalizedInput => ({
		...input,
		history: [...selected.values()]
			.filter((candidate) => candidate.source === 'history')
			.sort((left, right) => left.index - right.index)
			.map((candidate) => candidate.text)
			.join('\n'),
		retrievedContext: [...selected.values()]
			.filter((candidate) => candidate.source === 'retrievedContext')
			.sort((left, right) => left.index - right.index)
			.map((candidate) => candidate.text)
			.join('\n'),
	});
	const key = (candidate: Candidate) => `${candidate.source}:${candidate.index}`;

	for (const candidate of candidates.filter((entry) => entry.required)) {
		selected.set(key(candidate), candidate);
	}
	if (estimateSections(Object.values(build())) > maxTokens) {
		return { context: input, trimmed: false, budgetMet: false };
	}

	const optional = [
		...candidates.filter((entry) => entry.source === 'history' && !entry.required).reverse(),
		...candidates
			.filter((entry) => entry.source === 'retrievedContext' && !entry.required)
			.reverse(),
	];
	for (const candidate of optional) {
		selected.set(key(candidate), candidate);
		if (estimateSections(Object.values(build())) > maxTokens) {
			selected.delete(key(candidate));
		}
	}

	if (selected.size === 0 && optional.length > 0) {
		const candidate = optional[0];
		let low = 0;
		let high = candidate.text.length;
		let best = '';
		while (low <= high) {
			const length = Math.floor((low + high) / 2);
			const suffix = candidate.text.slice(Math.max(0, candidate.text.length - length));
			selected.set(key(candidate), { ...candidate, text: suffix });
			if (estimateSections(Object.values(build())) <= maxTokens) {
				best = suffix;
				low = length + 1;
			} else {
				high = length - 1;
			}
		}
		if (best) selected.set(key(candidate), { ...candidate, text: best });
		else selected.delete(key(candidate));
	}

	const context = build();
	return {
		context,
		trimmed: true,
		budgetMet: estimateSections(Object.values(context)) <= maxTokens,
	};
}

function customValues(input: OptimizeContextInput): string[] {
	if (Array.isArray(input.protectedValues)) return input.protectedValues;
	if (typeof input.protectedValues === 'string') {
		return input.protectedValues
			.split(/\r?\n|,/)
			.map((value) => value.trim())
			.filter(Boolean);
	}
	return [];
}

function createResult(
	original: NormalizedInput,
	optimized: NormalizedInput,
	profile: ResolvedProfile,
	startedAt: number,
	options: {
		strategy: 'deterministic' | 'hybrid' | 'fallback';
		summaryModelUsed: boolean;
		compressorTokens?: number;
		protectedFactsCount: number;
		warnings?: string[];
		fallbackReason?: FallbackReason;
	},
): OptimizeContextResult {
	const before = estimateSections(Object.values(original));
	const after = estimateSections(Object.values(optimized));
	const savingsTokens = Math.max(0, before - after);
	const savingsPercent = before === 0 ? 0 : Number(((savingsTokens / before) * 100).toFixed(2));
	const net = calculateNetSavings({
		originalTokens: before,
		sentTokens: after,
		compressorTokens: options.compressorTokens,
	});

	return {
		optimizedSystemPrompt: optimized.systemPrompt,
		optimizedHistory: optimized.history,
		optimizedRetrievedContext: optimized.retrievedContext,
		optimizedToolDefinitions: optimized.toolDefinitions,
		currentMessage: original.currentMessage,
		optimizedContext: combined(optimized),
		optimization: {
			profile: profile.name,
			strategy: options.strategy,
			tokensBefore: before,
			tokensAfter: after,
			budgetMet: after <= profile.maxInputTokens,
			tokensAreEstimated: true,
			savingsTokens,
			savingsPercent,
			grossSavingsTokens: net.grossTokens,
			netSavingsTokens: net.netTokens,
			netSavingsPercent: net.netPercent,
			summaryModelUsed: options.summaryModelUsed,
			compressorTokens: options.compressorTokens ?? 0,
			protectedFactsCount: options.protectedFactsCount,
			warnings: options.warnings ?? [],
			fallback: options.strategy === 'fallback',
			fallbackReason: options.fallbackReason,
			durationMs: Date.now() - startedAt,
		},
	};
}

export async function optimizeContext(
	input: OptimizeContextInput,
	options: OptimizeContextOptions = {},
	summaryAdapter?: SummaryAdapter,
): Promise<OptimizeContextResult> {
	const startedAt = Date.now();
	const profile = resolveProfile(options.profile ?? 'balanced', options.custom);
	const original = normalizeInput(input);
	const originalCombined = combined(original);
	const facts = extractProtectedFacts(originalCombined, customValues(input));

	try {
		const deterministic: NormalizedInput = {
			systemPrompt: compressSection(original.systemPrompt, profile),
			history: compressHistory(original.history, profile),
			retrievedContext: compressSection(original.retrievedContext, profile),
			toolDefinitions: compressSection(original.toolDefinitions, profile),
			currentMessage: original.currentMessage,
		};

		let optimized = deterministic;
		let strategy: 'deterministic' | 'hybrid' = 'deterministic';
		let summaryModelUsed = false;
		let compressorTokens = 0;
		const warnings: string[] = [];

		const eligibleText = [deterministic.history, deterministic.retrievedContext]
			.filter(Boolean)
			.join('\n\n');
		if (
			summaryAdapter &&
			estimateTokens(eligibleText) > profile.summaryThresholdTokens &&
			eligibleText.trim()
		) {
			summaryModelUsed = true;
			const summary = await summaryAdapter.summarize({
				text: eligibleText,
				maxTokens: Math.min(profile.maxInputTokens, profile.summaryThresholdTokens),
				protectedValues: facts.map((fact) => fact.value),
			});
			compressorTokens = summary.compressorTokens ?? 0;
			if (!summary.text.trim()) {
				return createResult(original, original, profile, startedAt, {
					strategy: 'fallback',
					summaryModelUsed,
					compressorTokens,
					protectedFactsCount: facts.length,
					fallbackReason: 'invalid_summary',
				});
			}
			optimized = {
				...deterministic,
				history: summary.text.trim(),
				retrievedContext: '',
			};
			strategy = 'hybrid';
			warnings.push(...(summary.warnings ?? []));
		}

		if (profile.allowUniqueContentTrimming) {
			const budget = enforceTokenBudget(
				optimized,
				profile.maxInputTokens,
				facts.map((fact) => fact.value),
			);
			if (!budget.budgetMet) {
				return createResult(original, original, profile, startedAt, {
					strategy: 'fallback',
					summaryModelUsed,
					compressorTokens,
					protectedFactsCount: facts.length,
					warnings: ['Configured token budget cannot preserve all protected content.'],
					fallbackReason: 'token_budget_unmet',
				});
			}
			optimized = budget.context;
			if (budget.trimmed) {
				warnings.push('Context trimmed to the configured token budget.');
			}
		} else if (estimateSections(Object.values(optimized)) > profile.maxInputTokens) {
			warnings.push('Token budget exceeded; unique content was preserved.');
		}

		if (!combined(optimized).trim()) {
			return createResult(original, original, profile, startedAt, {
				strategy: 'fallback',
				summaryModelUsed,
				compressorTokens,
				protectedFactsCount: facts.length,
				fallbackReason: 'empty_result',
			});
		}

		const validation = validateProtectedFacts(facts, combined(optimized));
		if (!validation.valid) {
			return createResult(original, original, profile, startedAt, {
				strategy: 'fallback',
				summaryModelUsed,
				compressorTokens,
				protectedFactsCount: facts.length,
				warnings: [`Missing protected values: ${validation.missing.join(', ')}`],
				fallbackReason: 'protected_fact_missing',
			});
		}

		const net = calculateNetSavings({
			originalTokens: estimateSections(Object.values(original)),
			sentTokens: estimateSections(Object.values(optimized)),
			compressorTokens,
			minimumNetSavingsTokens: profile.minimumNetSavingsTokens,
		});
		if (!net.useOptimized) {
			return createResult(original, original, profile, startedAt, {
				strategy: 'fallback',
				summaryModelUsed,
				compressorTokens,
				protectedFactsCount: facts.length,
				warnings: [
					...warnings,
					`Optimization skipped because net savings would be ${net.netTokens} tokens.`,
				],
				fallbackReason: net.reason ?? 'negative_net_savings',
			});
		}

		return createResult(original, optimized, profile, startedAt, {
			strategy,
			summaryModelUsed,
			compressorTokens,
			protectedFactsCount: facts.length,
			warnings,
		});
	} catch (error) {
		const reason: FallbackReason = summaryAdapter ? 'summary_error' : 'internal_error';
		return createResult(original, original, profile, startedAt, {
			strategy: 'fallback',
			summaryModelUsed: Boolean(summaryAdapter),
			protectedFactsCount: facts.length,
			warnings: [error instanceof Error ? error.message : String(error)],
			fallbackReason: reason,
		});
	}
}
