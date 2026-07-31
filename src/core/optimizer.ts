import { compressHistory, compressSection } from './deterministic-compressor';
import { normalizeSection, splitUnits } from './normalize';
import { resolveProfile } from './profiles';
import { extractProtectedFacts } from './protected-facts';
import { estimateSections, estimateTokens } from './token-estimator';
import { calculateNetSavings } from '../tokens/token-counter';
import { semanticDeduplicate } from '../semantic/semantic-deduplicator';
import { semanticRerank } from '../semantic/semantic-reranker';
import { selectQualityFallback } from '../quality/fallback-controller';
import type { ContentManifest } from '../content/types';
import type {
	SemanticPipelineAdapters,
	SemanticPipelineConfiguration,
	SemanticUnit,
} from '../semantic/types';
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

function textManifest(original: string, optimized: string): ContentManifest {
	return {
		contentType: 'text',
		originalHash: '',
		originalBytes: Buffer.byteLength(original),
		optimizedBytes: Buffer.byteLength(optimized),
		format: 'text',
	};
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
		semanticMethods?: string[];
		semanticFallbackUsed?: boolean;
		semanticConfidence?: number;
		verificationTokens?: number;
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
		verificationTokens: options.verificationTokens,
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
			semanticMethods: options.semanticMethods ?? [],
			semanticFallbackUsed: options.semanticFallbackUsed ?? false,
			...(options.semanticConfidence !== undefined
				? { semanticConfidence: options.semanticConfidence }
				: {}),
			verificationTokens: options.verificationTokens ?? 0,
		},
	};
}

function containsToolSequence(text: string): boolean {
	return /"(?:role)"\s*:\s*"(?:tool|function)"|"(?:tool_calls|tool_call_id|toolCalls|toolCallId)"\s*:/i.test(
		text,
	);
}

function semanticUnits(
	context: NormalizedInput,
	profile: ResolvedProfile,
	protectedValues: string[],
): SemanticUnit[] {
	const history = splitUnits(context.history);
	const retrieved = splitUnits(context.retrievedContext);
	const protectedHistoryStart = Math.max(0, history.length - profile.keepRecentMessages);
	return [
		...history.map((text, index) => ({
			id: `history:${index}`,
			source: 'history' as const,
			index,
			text,
			protected:
				index >= protectedHistoryStart || protectedValues.some((value) => text.includes(value)),
		})),
		...retrieved.map((text, index) => ({
			id: `retrieved:${index}`,
			source: 'retrieved_context' as const,
			index,
			text,
			protected: protectedValues.some((value) => text.includes(value)),
		})),
	];
}

function contextFromSemanticUnits(
	context: NormalizedInput,
	units: SemanticUnit[],
): NormalizedInput {
	return {
		...context,
		history: units
			.filter((unit) => unit.source === 'history')
			.sort((left, right) => left.index - right.index)
			.map((unit) => unit.text)
			.join('\n'),
		retrievedContext: units
			.filter((unit) => unit.source === 'retrieved_context')
			.sort((left, right) => left.index - right.index)
			.map((unit) => unit.text)
			.join('\n'),
	};
}

function semanticConfig(
	value: SemanticPipelineConfiguration | undefined,
): Required<SemanticPipelineConfiguration> {
	return {
		deduplicate: value?.deduplicate ?? false,
		rerank: value?.rerank ?? false,
		judge: value?.judge ?? false,
		minimumConfidence: Math.min(1, Math.max(0, value?.minimumConfidence ?? 0.85)),
		maximumUnits: Math.max(2, Math.floor(value?.maximumUnits ?? 40)),
		maximumSelectedUnits: Math.max(1, Math.floor(value?.maximumSelectedUnits ?? 12)),
		tokenBudget: Math.max(50, Math.floor(value?.tokenBudget ?? 4_000)),
	};
}

export async function optimizeContext(
	input: OptimizeContextInput,
	options: OptimizeContextOptions = {},
	summaryAdapter?: SummaryAdapter,
	semanticAdapters: SemanticPipelineAdapters = {},
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
		const semanticMethods: string[] = [];
		let semanticFallbackUsed = false;
		let semanticConfidence: number | undefined;
		let verificationTokens = 0;
		let semanticCandidateRejectedReason: string | undefined;
		const configuredSemantic = semanticConfig(options.semantic);
		const semanticRequested = configuredSemantic.deduplicate || configuredSemantic.rerank;
		if (semanticRequested && containsToolSequence(deterministic.history)) {
			semanticFallbackUsed = true;
			warnings.push('Semantic selection skipped because tool-call history must remain intact.');
		} else if (semanticRequested) {
			let units = semanticUnits(
				deterministic,
				profile,
				facts.map((fact) => fact.value),
			);
			if (configuredSemantic.deduplicate && semanticAdapters.deduplication && units.length > 1) {
				const deduplicated = await semanticDeduplicate(units, semanticAdapters.deduplication, {
					currentTask: original.currentMessage,
					minimumConfidence: configuredSemantic.minimumConfidence,
					maximumUnits: configuredSemantic.maximumUnits,
				});
				compressorTokens += deduplicated.compressorTokens;
				semanticConfidence = deduplicated.confidence;
				if (deduplicated.applied) {
					units = deduplicated.units;
					optimized = contextFromSemanticUnits(deterministic, units);
					semanticMethods.push('semantic-deduplication');
					strategy = 'hybrid';
				} else {
					semanticFallbackUsed = true;
					warnings.push(`Semantic deduplication skipped: ${deduplicated.fallbackReason}.`);
				}
			} else if (configuredSemantic.deduplicate && !semanticAdapters.deduplication) {
				semanticFallbackUsed = true;
				warnings.push('Semantic deduplication skipped because no adapter was connected.');
			}
			if (configuredSemantic.rerank) {
				if (!profile.allowUniqueContentTrimming) {
					semanticFallbackUsed = true;
					warnings.push(
						'Semantic reranking requires Custom profile with Allow Unique Content Trimming.',
					);
				} else if (semanticAdapters.reranking && units.length > 1) {
					const reranked = await semanticRerank(units, semanticAdapters.reranking, {
						currentTask: original.currentMessage,
						minimumConfidence: configuredSemantic.minimumConfidence,
						maximumUnits: configuredSemantic.maximumUnits,
						maximumSelectedUnits: configuredSemantic.maximumSelectedUnits,
						tokenBudget: configuredSemantic.tokenBudget,
					});
					compressorTokens += reranked.compressorTokens;
					semanticConfidence = Math.min(semanticConfidence ?? 1, reranked.confidence);
					if (reranked.applied) {
						units = reranked.units;
						optimized = contextFromSemanticUnits(deterministic, units);
						semanticMethods.push('semantic-reranking');
						strategy = 'hybrid';
					} else {
						semanticFallbackUsed = true;
						warnings.push(`Semantic reranking skipped: ${reranked.fallbackReason}.`);
					}
				} else if (!semanticAdapters.reranking) {
					semanticFallbackUsed = true;
					warnings.push('Semantic reranking skipped because no adapter was connected.');
				}
			}
		}

		const eligibleText = [optimized.history, optimized.retrievedContext]
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
			compressorTokens += summary.compressorTokens ?? 0;
			if (!summary.text.trim()) {
				optimized = deterministic;
				strategy = 'deterministic';
				semanticFallbackUsed = true;
				semanticCandidateRejectedReason = 'invalid_summary';
				warnings.push('Empty semantic summary rejected; deterministic context was used.');
			} else {
				optimized = {
					...optimized,
					history: summary.text.trim(),
					retrievedContext: '',
				};
				strategy = 'hybrid';
				semanticMethods.push('llm-summary');
				warnings.push(...(summary.warnings ?? []));
			}
		}

		if (configuredSemantic.judge && semanticAdapters.judge && semanticMethods.length > 0) {
			try {
				const judged = await semanticAdapters.judge.verify({
					original: [deterministic.history, deterministic.retrievedContext]
						.filter(Boolean)
						.join('\n\n'),
					candidate: [optimized.history, optimized.retrievedContext].filter(Boolean).join('\n\n'),
					currentTask: original.currentMessage,
					protectedValues: facts.map((fact) => fact.value),
				});
				verificationTokens += Math.max(0, judged.verificationTokens ?? 0);
				semanticConfidence = Math.min(semanticConfidence ?? 1, judged.confidence);
				if (
					!judged.meaningPreserved ||
					judged.missingFacts.length > 0 ||
					judged.contradictions.length > 0 ||
					judged.confidence < configuredSemantic.minimumConfidence
				) {
					optimized = deterministic;
					strategy = 'deterministic';
					semanticFallbackUsed = true;
					semanticCandidateRejectedReason = 'semantic_judge_rejected';
					semanticMethods.length = 0;
					warnings.push('Semantic candidate rejected by the optional judge.');
				}
			} catch {
				optimized = deterministic;
				strategy = 'deterministic';
				semanticFallbackUsed = true;
				semanticCandidateRejectedReason = 'semantic_judge_error';
				semanticMethods.length = 0;
				warnings.push('Semantic judge failed; deterministic context was used.');
			}
		} else if (configuredSemantic.judge && !semanticAdapters.judge && semanticMethods.length > 0) {
			optimized = deterministic;
			strategy = 'deterministic';
			semanticFallbackUsed = true;
			semanticCandidateRejectedReason = 'semantic_judge_missing';
			semanticMethods.length = 0;
			warnings.push('Semantic candidate rejected because no judge adapter was connected.');
		}

		let deterministicCandidate = deterministic;
		if (profile.allowUniqueContentTrimming) {
			const budget = enforceTokenBudget(
				optimized,
				profile.maxInputTokens,
				facts.map((fact) => fact.value),
			);
			if (!budget.budgetMet) {
				optimized = deterministic;
				strategy = 'deterministic';
				semanticFallbackUsed = true;
				semanticCandidateRejectedReason = 'token_budget_unmet';
				warnings.push('Semantic candidate could not meet the configured token budget.');
			} else {
				optimized = budget.context;
				if (budget.trimmed) warnings.push('Context trimmed to the configured token budget.');
			}
			const deterministicBudget = enforceTokenBudget(
				deterministic,
				profile.maxInputTokens,
				facts.map((fact) => fact.value),
			);
			if (deterministicBudget.budgetMet) {
				deterministicCandidate = deterministicBudget.context;
			} else {
				warnings.push('Deterministic context cannot meet budget while preserving protected data.');
			}
		} else if (estimateSections(Object.values(optimized)) > profile.maxInputTokens) {
			warnings.push('Token budget exceeded; unique content was preserved.');
		}

		const originalText = combined(original);
		const optimizedText = combined(optimized);
		const deterministicText = combined(deterministicCandidate);
		const fallback = selectQualityFallback({
			original: {
				name: 'original',
				value: original,
				content: originalText,
				manifest: textManifest(originalText, originalText),
			},
			candidates: [
				...(strategy === 'hybrid'
					? [
							{
								name: 'semantic',
								value: optimized,
								content: optimizedText,
								manifest: textManifest(originalText, optimizedText),
								eligible: !semanticCandidateRejectedReason,
								rejectionReason: semanticCandidateRejectedReason,
							},
						]
					: []),
				{
					name: 'deterministic',
					value: deterministicCandidate,
					content: deterministicText,
					manifest: textManifest(originalText, deterministicText),
					eligible: Boolean(deterministicText.trim()),
					rejectionReason: 'empty_result',
				},
			],
			protectedValues: facts.map((fact) => fact.value),
			level: options.qualityLevel ?? 'strict',
			compressorTokens,
			verificationTokens,
			minimumNetSavingsTokens: profile.minimumNetSavingsTokens,
		});
		warnings.push(...fallback.warnings);
		if (fallback.selected.name === 'original') {
			if (strategy === 'hybrid') {
				semanticFallbackUsed = true;
				semanticMethods.length = 0;
			}
			const lastWarning = fallback.warnings[fallback.warnings.length - 1] ?? '';
			const fallbackReason: FallbackReason = lastWarning.includes('protected-facts')
				? 'protected_fact_missing'
				: lastWarning.includes('token_budget_unmet')
					? 'token_budget_unmet'
					: lastWarning.includes('negative_net_savings') || lastWarning.includes('minimum_net')
						? 'negative_net_savings'
						: 'quality_guard_failed';
			return createResult(original, original, profile, startedAt, {
				strategy: 'fallback',
				summaryModelUsed,
				compressorTokens,
				protectedFactsCount: facts.length,
				warnings,
				fallbackReason,
				semanticFallbackUsed,
				verificationTokens,
			});
		}
		optimized = fallback.selected.value;
		if (fallback.selected.name === 'deterministic' && strategy === 'hybrid') {
			strategy = 'deterministic';
			semanticFallbackUsed = true;
			semanticMethods.length = 0;
		}

		return createResult(original, optimized, profile, startedAt, {
			strategy,
			summaryModelUsed,
			compressorTokens,
			protectedFactsCount: facts.length,
			warnings,
			semanticMethods,
			semanticFallbackUsed,
			semanticConfidence,
			verificationTokens,
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
