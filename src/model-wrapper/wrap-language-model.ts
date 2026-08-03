import { deduplicateUnits } from '../core/deduplicate';
import { optimizeContent } from '../content/optimize-content';
import { extractProtectedFacts } from '../core/protected-facts';
import { isSavingsProfile, resolveProfile } from '../core/profiles';
import { estimateTokens } from '../core/token-estimator';
import type { OptimizeContextOptions } from '../core/types';
import { extractProviderUsage } from '../analytics/provider-usage';
import { decideCacheAction } from '../cache/policy-engine';
import type { CacheBlockKind, CacheBlockVolatility, CacheStrategy } from '../cache/policy-types';
import type { FingerprintRegistry } from '../cache/types';
import { ToolRegistry } from '../tools/tool-registry';
import {
	selectToolSchemas,
	type ToolSchemaSelectionOptions,
	type ToolSchemaSelectionResult,
} from '../tools/tool-schema-selector';
import {
	type MaximumSavingsFallbackReason,
	type MaximumSavingsOptions,
	virtualizeMaximumSavingsToolResult,
} from './maximum-savings-virtualizer';
import {
	analyzeToolSequence,
	messageHasToolData,
	messageRole,
	type MessageLike,
	type ToolSequenceIssue,
} from './message-sequence';
import {
	resolveAdaptiveProfile,
	type AdaptiveProfileResult,
	type AdaptiveRiskSignal,
} from '../policy/adaptive-profile';
import { compileSystemPrompt } from '../prompt/system-prompt-compiler';

export type ModelBypassReason = 'tool_sequence_content_only' | ToolSequenceIssue;

export interface LanguageModelLike {
	invoke?: (input: unknown, ...args: unknown[]) => Promise<unknown>;
	batch?: (inputs: unknown[], ...args: unknown[]) => Promise<unknown>;
	stream?: (input: unknown, ...args: unknown[]) => Promise<unknown> | AsyncIterable<unknown>;
	generate?: (messages: unknown, ...args: unknown[]) => Promise<unknown>;
	bindTools?: (...args: unknown[]) => object;
}

export interface ModelOptimizationMetrics {
	operation: 'invoke' | 'batch' | 'stream' | 'generate';
	profile: string;
	messagesBefore: number;
	messagesAfter: number;
	tokensBeforeEstimated: number;
	tokensAfterEstimated: number;
	savingsTokensEstimated: number;
	savingsPercentEstimated: number;
	protectedFactsCount: number;
	tokensAreEstimated: true;
	eligibleTokensBefore: number;
	eligibleTokensAfter: number;
	eligibleSavingsPercent: number;
	virtualizedResourceIds: string[];
	retrievalRequired: boolean;
	targetBandReached: boolean;
	targetNotReachedReason?: MaximumSavingsFallbackReason | 'virtualization_not_configured';
	storageFallbackUsed: boolean;
	cacheStrategy: CacheStrategy;
	cacheDecision:
		| 'legacy_profile_only'
		| 'preserve_stable_prefix'
		| 'reduce_dynamic_blocks'
		| 'hybrid'
		| 'no_change';
	stablePrefixTokens: number;
	dynamicTokensBefore: number;
	dynamicTokensAfter: number;
	cacheRegistryScope: 'disabled' | 'process_local' | 'worker_local' | 'shared_redis';
	cacheWarning?: 'queue_mode_local_registry';
	bypassReason?: ModelBypassReason;
	toolSchemasBefore?: number;
	toolSchemasAfter?: number;
	toolSchemaTokensBefore?: number;
	toolSchemaTokensAfter?: number;
	toolSchemaSelectionReason?: ToolSchemaSelectionResult['reason'];
	toolSchemaSelectionConfidence?: number;
	selectedProfile?: string;
	effectiveProfile?: string;
	adaptiveRiskLevel?: AdaptiveProfileResult['riskLevel'];
	adaptiveRiskSignals?: AdaptiveRiskSignal[];
	adaptiveDowngrade?: boolean;
	promptTokensBefore?: number;
	promptTokensAfter?: number;
	promptSavedTokens?: number;
}

export interface ModelInvocationObserver {
	onStart?(metrics: ModelOptimizationMetrics): unknown;
	onSuccess?(traceId: unknown, response: unknown, metrics: ModelOptimizationMetrics): void;
	onError?(traceId: unknown, error: unknown, metrics: ModelOptimizationMetrics): void;
}

export interface LanguageModelWrapperOptions extends OptimizeContextOptions {
	observer?: ModelInvocationObserver;
	optimizeMessages?: boolean;
	maximumSavings?: MaximumSavingsOptions;
	cacheAware?: CacheAwareModelOptions;
	toolSelection?: Omit<
		ToolSchemaSelectionOptions,
		'bindOptions' | 'profile' | 'recentlyUsedTools' | 'registry'
	>;
	toolSelectionEvidence?: ToolSchemaSelectionResult;
	adaptiveOptimization?: boolean;
	compileSystemPrompt?: boolean;
}

export interface CacheAwareModelOptions {
	strategy: CacheStrategy;
	registry?: FingerprintRegistry;
	scope: string;
	minimumRepetitions: number;
	minimumStablePrefixTokens: number;
	registryScope?: 'process_local' | 'worker_local' | 'shared_redis';
}

interface OptimizedModelInput {
	input: unknown;
	metrics: Omit<ModelOptimizationMetrics, 'operation'>;
	cacheFingerprints: string[];
	cacheMetrics: CacheOptimizationMetrics;
}

function messageText(message: MessageLike): string {
	if (typeof message.content === 'string') return message.content;
	if (Array.isArray(message.content)) {
		return message.content
			.map((entry) => {
				if (typeof entry === 'string') return entry;
				if (entry && typeof entry === 'object' && 'text' in entry) {
					return String((entry as { text: unknown }).text);
				}
				return JSON.stringify(entry);
			})
			.join('\n');
	}
	return message.content === undefined ? '' : JSON.stringify(message.content);
}

interface OptimizedMessages {
	messages: unknown[];
	bypassReason?: ModelBypassReason;
	toolMetrics?: ToolOptimizationMetrics;
	cacheFingerprints?: string[];
	cacheMetrics?: CacheOptimizationMetrics;
	adaptiveMetrics?: AdaptiveOptimizationMetrics;
}

interface AdaptiveOptimizationMetrics {
	profile: AdaptiveProfileResult;
	promptTokensBefore: number;
	promptTokensAfter: number;
}

interface CacheOptimizationMetrics {
	stablePrefixTokens: number;
	dynamicTokensBefore: number;
	dynamicTokensAfter: number;
}

interface MessageEntry {
	message: unknown;
	index: number;
	role: string;
	text: string;
	hasToolData: boolean;
}

interface ToolOptimizationMetrics {
	eligibleTokensBefore: number;
	eligibleTokensAfter: number;
	virtualizedResourceIds: string[];
	retrievalRequired: boolean;
	targetBandReached: boolean;
	targetNotReachedReason?: MaximumSavingsFallbackReason | 'virtualization_not_configured';
	storageFallbackUsed: boolean;
}

function cloneWithContent(message: MessageLike, content: string): MessageLike {
	const descriptors = Object.getOwnPropertyDescriptors(message);
	descriptors.content = {
		...descriptors.content,
		value: content,
		writable: true,
		enumerable: descriptors.content?.enumerable ?? true,
		configurable: true,
	};
	return Object.create(Object.getPrototypeOf(message), descriptors) as MessageLike;
}

function toolPayloadText(value: unknown, depth = 0): string | undefined {
	if (depth > 3) return undefined;
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value) as unknown;
			if (parsed && typeof parsed === 'object') {
				const unwrapped = toolPayloadText(parsed, depth + 1);
				if (unwrapped !== undefined) return unwrapped;
			}
		} catch {
			// Plain text is already a valid tool result.
		}
		return value;
	}
	if (Array.isArray(value)) {
		if (value.length === 0) return undefined;
		const isContentBlock = value.every((part) => {
			if (typeof part === 'string') return true;
			if (!part || typeof part !== 'object' || Array.isArray(part)) return false;
			const record = part as Record<string, unknown>;
			return (
				record.type === 'text' ||
				record.type === 'tool_result' ||
				record.response !== undefined ||
				record.text !== undefined ||
				record.content !== undefined
			);
		});
		if (!isContentBlock) {
			try {
				return JSON.stringify(value);
			} catch {
				return undefined;
			}
		}
		const parts = value.map((part) => toolPayloadText(part, depth + 1));
		return parts.every((part): part is string => part !== undefined) ? parts.join('\n') : undefined;
	}
	if (!value || typeof value !== 'object') return undefined;
	const record = value as Record<string, unknown>;
	const blockType = typeof record.type === 'string' ? record.type : undefined;
	if (blockType && blockType !== 'text' && blockType !== 'tool_result') {
		return undefined;
	}
	for (const key of ['response', 'text', 'content']) {
		if (record[key] !== undefined) {
			const unwrapped = toolPayloadText(record[key], depth + 1);
			if (unwrapped !== undefined) return unwrapped;
		}
	}
	try {
		return JSON.stringify(value);
	} catch {
		return undefined;
	}
}

function optimizableToolText(message: MessageLike): string | undefined {
	return toolPayloadText(message.content);
}

function taskText(messages: unknown[]): string {
	const user = [...messages].reverse().find((raw) => messageRole(raw as MessageLike) === 'user') as
		| MessageLike
		| undefined;
	const toolCalls = messages
		.map((raw) => raw as MessageLike)
		.filter((message) => messageRole(message) === 'assistant')
		.flatMap((message) => [message.tool_calls, message.additional_kwargs, message.additionalKwargs])
		.filter((value) => value !== undefined)
		.map((value) => {
			try {
				return JSON.stringify(value);
			} catch {
				return '';
			}
		});
	return [user ? messageText(user) : '', ...toolCalls].filter(Boolean).join('\n');
}

function isUserCorrection(entry: MessageEntry): boolean {
	if (entry.role !== 'user') return false;
	return /(?:^|\b)(?:corre[cç][aã]o|corrigindo|na verdade|quis dizer|actually|correction|i meant)(?:\b|:)/i.test(
		entry.text,
	);
}

function coerceMessages(input: unknown): unknown[] {
	if (Array.isArray(input)) return input;
	if (
		input &&
		typeof input === 'object' &&
		'toChatMessages' in input &&
		typeof (input as { toChatMessages: unknown }).toChatMessages === 'function'
	) {
		try {
			return (input as { toChatMessages: () => unknown[] }).toChatMessages();
		} catch {
			return [input];
		}
	}
	return input === undefined || input === null ? [] : [input];
}

function adaptiveRiskSignals(
	messages: unknown[],
	options: LanguageModelWrapperOptions,
): AdaptiveRiskSignal[] {
	const signals = new Set<AdaptiveRiskSignal>();
	const toolSequence = analyzeToolSequence(messages);
	if (toolSequence.activeMessageIndexes.length > 0) signals.add('active_tool_sequence');
	if (messages.some((message) => !message || typeof message !== 'object')) {
		signals.add('unknown_message_shape');
	}
	const latestUser = [...messages]
		.reverse()
		.find((message) => messageRole(message as MessageLike) === 'user') as MessageLike | undefined;
	const task = latestUser ? messageText(latestUser) : '';
	if (/```|\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b|\{\s*"[^"\n]+"\s*:/i.test(task)) {
		signals.add('code_or_query');
	}
	if (
		/\b(?:exact|exactly|verbatim|literal|quote exactly|exato|exatamente|literalmente|ipsis litteris|cite exatamente)\b/i.test(
			task,
		)
	) {
		signals.add('exact_quote_requested');
	}
	const evidence = options.toolSelectionEvidence;
	if (evidence?.reason === 'structured_output_ambiguous') signals.add('structured_output');
	if (evidence?.reason === 'low_confidence') signals.add('low_tool_confidence');
	if (
		isSavingsProfile(options.profile) &&
		(!options.maximumSavings || !options.maximumSavings.retrieverAvailable)
	) {
		signals.add('retrieval_unavailable');
	}
	return [...signals];
}

function compileSystemMessages(
	messages: unknown[],
	enabled: boolean,
): { messages: unknown[]; tokensBefore: number; tokensAfter: number } {
	if (!enabled) return { messages, tokensBefore: 0, tokensAfter: 0 };
	let changed = false;
	let tokensBefore = 0;
	let tokensAfter = 0;
	const compiled = messages.map((raw) => {
		const message = raw as MessageLike;
		if (messageRole(message) !== 'system') return raw;
		const text = messageText(message);
		const result = compileSystemPrompt(text);
		tokensBefore += result.tokensBefore;
		tokensAfter += result.tokensAfter;
		if (!result.changed) return raw;
		changed = true;
		return cloneWithContent(message, result.content);
	});
	return { messages: changed ? compiled : messages, tokensBefore, tokensAfter };
}

function combineAdaptiveMetrics(
	metrics: Array<AdaptiveOptimizationMetrics | undefined>,
): AdaptiveOptimizationMetrics | undefined {
	const available = metrics.filter(
		(entry): entry is AdaptiveOptimizationMetrics => entry !== undefined,
	);
	if (available.length === 0) return undefined;
	const profileRank = { quality: 0, balanced: 1, savings: 2, custom: 3 } as const;
	const riskRank = { low: 0, medium: 1, high: 2 } as const;
	const first = available[0].profile;
	const effectiveProfile = available
		.map((entry) => entry.profile.effectiveProfile)
		.sort((left, right) => profileRank[left] - profileRank[right])[0];
	const riskLevel = available
		.map((entry) => entry.profile.riskLevel)
		.sort((left, right) => riskRank[right] - riskRank[left])[0];
	const signals = [...new Set(available.flatMap((entry) => entry.profile.signals))];
	return {
		profile: {
			selectedProfile: first.selectedProfile,
			effectiveProfile,
			riskLevel,
			signals,
			downgraded: effectiveProfile !== first.selectedProfile,
		},
		promptTokensBefore: available.reduce((total, entry) => total + entry.promptTokensBefore, 0),
		promptTokensAfter: available.reduce((total, entry) => total + entry.promptTokensAfter, 0),
	};
}

function cacheBlockKind(
	entry: MessageEntry,
	latestMessageIndex: number,
	recentWindowStart: number,
): CacheBlockKind {
	if (entry.role === 'system') return 'system_prompt';
	if (entry.index === latestMessageIndex) return 'current_message';
	if (isUserCorrection(entry)) return 'user_correction';
	if (entry.index >= recentWindowStart) return 'recent_history';
	return 'old_history';
}

function blockVolatility(kind: CacheBlockKind): CacheBlockVolatility {
	if (kind === 'system_prompt' || kind === 'tool_schema' || kind === 'protected_content') {
		return 'stable';
	}
	if (kind === 'tool_output' || kind === 'external_data' || kind === 'logs') {
		return 'variable';
	}
	return 'unknown';
}

async function applyCachePolicy(
	entries: MessageEntry[],
	structurallyProtected: Set<number>,
	recentWindowStart: number,
	options: LanguageModelWrapperOptions,
): Promise<{
	protectedIndexes: Set<number>;
	fingerprints: string[];
	stablePrefixTokens: number;
	dynamicIndexes: Set<number>;
}> {
	const cache = options.cacheAware;
	if (!cache || cache.strategy === 'ignore_cache_signals') {
		return {
			protectedIndexes: new Set(),
			fingerprints: [],
			stablePrefixTokens: 0,
			dynamicIndexes: new Set(),
		};
	}

	const protectedIndexes = new Set<number>();
	const fingerprints: string[] = [];
	const dynamicIndexes = new Set<number>();
	let stablePrefixTokens = 0;
	const latestMessageIndex = entries.length - 1;
	let commonPrefixTokens = 0;
	for (const entry of entries) {
		const estimatedTokens = estimateTokens(entry.text);
		commonPrefixTokens += estimatedTokens;
		const inCommonPrefix = entry.index < latestMessageIndex;
		const kind = cacheBlockKind(entry, latestMessageIndex, recentWindowStart);
		const mandatory = structurallyProtected.has(entry.index) || isUserCorrection(entry);
		let fingerprint: { seenCount: number; lastProviderCachedTokens?: number } | undefined;
		if (inCommonPrefix && entry.text && cache.registry) {
			try {
				const observed = await cache.registry.observe({
					scope: cache.scope,
					position: `messages[${entry.index}].content`,
					content: entry.text,
					estimatedTokens,
				});
				fingerprints.push(observed.fingerprint);
				fingerprint = observed;
			} catch {
				// Cache metadata must never break a provider request.
			}
		}
		const selected = decideCacheAction({
			strategy: cache.strategy,
			profile: options.profile ?? 'balanced',
			kind,
			estimatedTokens,
			commonPrefixTokens,
			inCommonPrefix,
			volatility: blockVolatility(kind),
			eligible: Boolean(entry.text),
			mandatory,
			virtualizationReady: false,
			minimumRepetitions: cache.minimumRepetitions,
			minimumStablePrefixTokens: cache.minimumStablePrefixTokens,
			fingerprint,
		});
		if (selected.action === 'preserve') protectedIndexes.add(entry.index);
		if (
			selected.action === 'preserve' &&
			['provider_cache_evidence', 'stable_repeated_prefix', 'large_common_prefix'].includes(
				selected.reason,
			)
		) {
			stablePrefixTokens += estimatedTokens;
		}
		if (selected.action !== 'preserve') dynamicIndexes.add(entry.index);
	}
	return { protectedIndexes, fingerprints, stablePrefixTokens, dynamicIndexes };
}

function emptyToolMetrics(
	reason?: ToolOptimizationMetrics['targetNotReachedReason'],
): ToolOptimizationMetrics {
	return {
		eligibleTokensBefore: 0,
		eligibleTokensAfter: 0,
		virtualizedResourceIds: [],
		retrievalRequired: false,
		targetBandReached: false,
		...(reason ? { targetNotReachedReason: reason } : {}),
		storageFallbackUsed: false,
	};
}

function emptyCacheMetrics(): CacheOptimizationMetrics {
	return {
		stablePrefixTokens: 0,
		dynamicTokensBefore: 0,
		dynamicTokensAfter: 0,
	};
}

function combineCacheMetrics(metrics: CacheOptimizationMetrics[]): CacheOptimizationMetrics {
	return metrics.reduce(
		(combined, current) => ({
			stablePrefixTokens: combined.stablePrefixTokens + current.stablePrefixTokens,
			dynamicTokensBefore: combined.dynamicTokensBefore + current.dynamicTokensBefore,
			dynamicTokensAfter: combined.dynamicTokensAfter + current.dynamicTokensAfter,
		}),
		emptyCacheMetrics(),
	);
}

function combineToolMetrics(
	metrics: Array<
		Pick<
			ModelOptimizationMetrics,
			| 'eligibleTokensBefore'
			| 'eligibleTokensAfter'
			| 'virtualizedResourceIds'
			| 'retrievalRequired'
			| 'targetBandReached'
			| 'targetNotReachedReason'
			| 'storageFallbackUsed'
		>
	>,
): ToolOptimizationMetrics {
	const combined = emptyToolMetrics();
	for (const entry of metrics) {
		combined.eligibleTokensBefore += entry.eligibleTokensBefore;
		combined.eligibleTokensAfter += entry.eligibleTokensAfter;
		combined.virtualizedResourceIds.push(...entry.virtualizedResourceIds);
		combined.retrievalRequired ||= entry.retrievalRequired;
		combined.targetBandReached ||= entry.targetBandReached;
		combined.storageFallbackUsed ||= entry.storageFallbackUsed;
		if (entry.targetNotReachedReason)
			combined.targetNotReachedReason = entry.targetNotReachedReason;
	}
	if (combined.eligibleTokensBefore > 0) {
		combined.targetBandReached =
			combined.eligibleTokensAfter <= combined.eligibleTokensBefore * 0.3;
		if (combined.targetBandReached) delete combined.targetNotReachedReason;
	}
	return combined;
}

async function optimizeToolResults(
	messages: unknown[],
	options: LanguageModelWrapperOptions,
	eligibleIndexes?: Set<number>,
): Promise<{ messages: unknown[]; changed: boolean; metrics: ToolOptimizationMetrics }> {
	let changed = false;
	const metrics = emptyToolMetrics(
		isSavingsProfile(options.profile) && !options.maximumSavings
			? 'virtualization_not_configured'
			: undefined,
	);
	const currentTask = taskText(messages);
	const optimized: unknown[] = [];
	for (const [index, raw] of messages.entries()) {
		const message = raw as MessageLike;
		if (messageRole(message) !== 'tool' || (eligibleIndexes && !eligibleIndexes.has(index))) {
			optimized.push(raw);
			continue;
		}
		const toolText = optimizableToolText(message);
		if (toolText === undefined) {
			optimized.push(raw);
			continue;
		}
		const result = optimizeContent(toolText, {
			contentType: 'tool_output',
			profile: options.profile,
		});
		if (!result.quality.passed) {
			optimized.push(raw);
			continue;
		}

		let content = result.optimizedContent;
		if (isSavingsProfile(options.profile) && options.maximumSavings) {
			const virtualized = await virtualizeMaximumSavingsToolResult({
				originalContent: toolText,
				structural: result,
				currentTask,
				options: options.maximumSavings,
			});
			content = virtualized.content;
			metrics.eligibleTokensBefore += virtualized.eligibleTokensBefore;
			metrics.eligibleTokensAfter += virtualized.eligibleTokensAfter;
			if (virtualized.resourceId) metrics.virtualizedResourceIds.push(virtualized.resourceId);
			metrics.retrievalRequired ||= virtualized.retrievalRequired;
			metrics.targetBandReached ||= virtualized.targetBandReached;
			metrics.storageFallbackUsed ||= virtualized.storageFallbackUsed;
			if (virtualized.targetNotReachedReason) {
				metrics.targetNotReachedReason = virtualized.targetNotReachedReason;
			}
		} else if (result.tokens.optimized >= result.tokens.original) {
			optimized.push(raw);
			continue;
		} else {
			metrics.eligibleTokensBefore += result.tokens.original;
			metrics.eligibleTokensAfter += result.tokens.optimized;
		}
		if (content === toolText) {
			optimized.push(raw);
			continue;
		}
		changed = true;
		optimized.push(cloneWithContent(message, content));
	}
	if (metrics.eligibleTokensBefore > 0) {
		const profile = resolveProfile(options.profile ?? 'balanced', options.custom);
		metrics.targetBandReached =
			metrics.eligibleTokensAfter <=
			metrics.eligibleTokensBefore * (1 - profile.eligibleSavingsMinPercent / 100);
		if (metrics.targetBandReached && !metrics.storageFallbackUsed) {
			delete metrics.targetNotReachedReason;
		}
	}
	return { messages: changed ? optimized : messages, changed, metrics };
}

async function optimizeMessages(
	messages: unknown[],
	options: LanguageModelWrapperOptions,
): Promise<OptimizedMessages> {
	const toolSequence = analyzeToolSequence(messages);
	if (toolSequence.hasToolData && !toolSequence.valid) {
		return {
			messages,
			bypassReason: toolSequence.issue,
		};
	}
	const selectedProfile = options.profile ?? 'balanced';
	const adaptive =
		options.adaptiveOptimization === false
			? resolveAdaptiveProfile(selectedProfile, [])
			: resolveAdaptiveProfile(selectedProfile, adaptiveRiskSignals(messages, options));
	const activeOptions: LanguageModelWrapperOptions = {
		...options,
		profile: adaptive.effectiveProfile,
	};
	const compiledPrompt = compileSystemMessages(
		messages,
		options.compileSystemPrompt !== false,
	);
	const compiledMessages = compiledPrompt.messages;
	const optimizedTools = toolSequence.hasToolData
		? await optimizeToolResults(
				compiledMessages,
				activeOptions,
				new Set(toolSequence.completedResultIndexes),
			)
		: { messages: compiledMessages, changed: false, metrics: emptyToolMetrics() };
	const workingMessages = optimizedTools.messages;

	const profile = resolveProfile(activeOptions.profile ?? 'balanced', options.custom);
	const entries: MessageEntry[] = workingMessages.map((message, index) => {
		const value = message as MessageLike;
		return {
			message,
			index,
			role: messageRole(value),
			text: messageText(value),
			hasToolData: messageHasToolData(value),
		};
	});

	const latestMessageIndex = entries.length - 1;
	const recentWindowStart = Math.max(0, entries.length - profile.keepRecentMessages);
	const structurallyProtected = new Set(
		entries
			.filter(
				(entry) =>
					entry.index === latestMessageIndex ||
					entry.index >= recentWindowStart ||
					entry.role === 'system' ||
					entry.role === 'tool' ||
					entry.hasToolData,
			)
			.map((entry) => entry.index),
	);
	for (const index of toolSequence.structuralMessageIndexes) structurallyProtected.add(index);
	const cachePolicy = await applyCachePolicy(
		entries,
		structurallyProtected,
		recentWindowStart,
		activeOptions,
	);
	for (const index of cachePolicy.protectedIndexes) structurallyProtected.add(index);
	const acceptedRegularIndexes = new Set<number>();
	const acceptedRegularTexts = deduplicateUnits(
		entries
			.filter((entry) => structurallyProtected.has(entry.index))
			.map((entry) => `${entry.role}:${entry.text}`),
		profile.approximateDeduplication,
	);
	for (const entry of [...entries].reverse()) {
		if (structurallyProtected.has(entry.index)) continue;
		const key = `${entry.role}:${entry.text}`;
		const next = deduplicateUnits([...acceptedRegularTexts, key], profile.approximateDeduplication);
		if (next.length === acceptedRegularTexts.length) continue;
		acceptedRegularTexts.push(key);
		acceptedRegularIndexes.add(entry.index);
	}

	const kept = entries.filter((entry) => {
		if (structurallyProtected.has(entry.index)) return true;
		return acceptedRegularIndexes.has(entry.index);
	});

	if (kept.length === 0 && entries.length > 0) {
		return {
			messages: [entries[entries.length - 1].message],
			toolMetrics: optimizedTools.metrics,
			...(optimizedTools.changed ? { bypassReason: 'tool_sequence_content_only' as const } : {}),
			cacheFingerprints: cachePolicy.fingerprints,
			cacheMetrics: {
				stablePrefixTokens: cachePolicy.stablePrefixTokens,
				dynamicTokensBefore: entries
					.filter((entry) => cachePolicy.dynamicIndexes.has(entry.index))
					.reduce((total, entry) => total + estimateTokens(entry.text), 0),
				dynamicTokensAfter: cachePolicy.dynamicIndexes.has(entries.length - 1)
					? estimateTokens(entries[entries.length - 1].text)
					: 0,
			},
			adaptiveMetrics: {
				profile: adaptive,
				promptTokensBefore: compiledPrompt.tokensBefore,
				promptTokensAfter: compiledPrompt.tokensAfter,
			},
		};
	}
	return {
		messages: kept.map((entry) => entry.message),
		toolMetrics: optimizedTools.metrics,
		...(optimizedTools.changed && kept.length === entries.length
			? { bypassReason: 'tool_sequence_content_only' as const }
			: {}),
		cacheFingerprints: cachePolicy.fingerprints,
		cacheMetrics: {
			stablePrefixTokens: cachePolicy.stablePrefixTokens,
			dynamicTokensBefore: entries
				.filter((entry) => cachePolicy.dynamicIndexes.has(entry.index))
				.reduce((total, entry) => total + estimateTokens(entry.text), 0),
			dynamicTokensAfter: kept
				.filter((entry) => cachePolicy.dynamicIndexes.has(entry.index))
				.reduce((total, entry) => total + estimateTokens(entry.text), 0),
		},
		adaptiveMetrics: {
			profile: adaptive,
			promptTokensBefore: compiledPrompt.tokensBefore,
			promptTokensAfter: compiledPrompt.tokensAfter,
		},
	};
}

function optimizationMetrics(
	before: unknown[],
	after: unknown[],
	options: OptimizeContextOptions,
	bypassReason?: ModelBypassReason,
	toolMetrics = emptyToolMetrics(),
	cacheMetrics = emptyCacheMetrics(),
	adaptiveMetrics?: AdaptiveOptimizationMetrics,
): Omit<ModelOptimizationMetrics, 'operation'> {
	const beforeText = before.map((message) => messageText(message as MessageLike)).join('\n');
	const afterText = after.map((message) => messageText(message as MessageLike)).join('\n');
	const toolSelection =
		'toolSelectionEvidence' in options
			? (options as LanguageModelWrapperOptions).toolSelectionEvidence
			: undefined;
	const tokensBeforeEstimated = estimateTokens(beforeText) + (toolSelection?.tokensBefore ?? 0);
	const tokensAfterEstimated = estimateTokens(afterText) + (toolSelection?.tokensAfter ?? 0);
	const savingsTokensEstimated = Math.max(0, tokensBeforeEstimated - tokensAfterEstimated);
	const stablePrefixTokens = cacheMetrics.stablePrefixTokens;
	const dynamicTokensBefore = cacheMetrics.dynamicTokensBefore + toolMetrics.eligibleTokensBefore;
	const dynamicTokensAfter = cacheMetrics.dynamicTokensAfter + toolMetrics.eligibleTokensAfter;
	const cacheStrategy =
		'cacheAware' in options && (options as LanguageModelWrapperOptions).cacheAware
			? ((options as LanguageModelWrapperOptions).cacheAware?.strategy ?? 'ignore_cache_signals')
			: 'ignore_cache_signals';
	const cacheDecision =
		cacheStrategy === 'ignore_cache_signals'
			? 'legacy_profile_only'
			: stablePrefixTokens > 0 && dynamicTokensAfter < dynamicTokensBefore
				? 'hybrid'
				: stablePrefixTokens > 0
					? 'preserve_stable_prefix'
					: dynamicTokensAfter < dynamicTokensBefore
						? 'reduce_dynamic_blocks'
						: 'no_change';
	return {
		profile:
			'optimizeMessages' in options &&
			(options as LanguageModelWrapperOptions).optimizeMessages === false
				? 'measure_only'
				: (adaptiveMetrics?.profile.selectedProfile ??
					resolveProfile(options.profile ?? 'balanced', options.custom).name),
		messagesBefore: before.length,
		messagesAfter: after.length,
		tokensBeforeEstimated,
		tokensAfterEstimated,
		savingsTokensEstimated,
		savingsPercentEstimated:
			tokensBeforeEstimated === 0
				? 0
				: Number(((savingsTokensEstimated / tokensBeforeEstimated) * 100).toFixed(2)),
		protectedFactsCount: extractProtectedFacts(beforeText).length,
		tokensAreEstimated: true,
		eligibleTokensBefore: toolMetrics.eligibleTokensBefore,
		eligibleTokensAfter: toolMetrics.eligibleTokensAfter,
		eligibleSavingsPercent:
			toolMetrics.eligibleTokensBefore === 0
				? 0
				: Number(
						(
							((toolMetrics.eligibleTokensBefore - toolMetrics.eligibleTokensAfter) /
								toolMetrics.eligibleTokensBefore) *
							100
						).toFixed(2),
					),
		virtualizedResourceIds: [...toolMetrics.virtualizedResourceIds],
		retrievalRequired: toolMetrics.retrievalRequired,
		targetBandReached: toolMetrics.targetBandReached,
		...(toolMetrics.targetNotReachedReason
			? { targetNotReachedReason: toolMetrics.targetNotReachedReason }
			: {}),
		storageFallbackUsed: toolMetrics.storageFallbackUsed,
		cacheStrategy,
		cacheDecision,
		stablePrefixTokens,
		dynamicTokensBefore,
		dynamicTokensAfter,
		cacheRegistryScope:
			cacheStrategy === 'ignore_cache_signals'
				? 'disabled'
				: ((options as LanguageModelWrapperOptions).cacheAware?.registryScope ?? 'process_local'),
		...((options as LanguageModelWrapperOptions).cacheAware?.registryScope === 'worker_local'
			? { cacheWarning: 'queue_mode_local_registry' as const }
			: {}),
		...(adaptiveMetrics
			? {
					selectedProfile: adaptiveMetrics.profile.selectedProfile,
					effectiveProfile: adaptiveMetrics.profile.effectiveProfile,
					adaptiveRiskLevel: adaptiveMetrics.profile.riskLevel,
					adaptiveRiskSignals: adaptiveMetrics.profile.signals,
					adaptiveDowngrade: adaptiveMetrics.profile.downgraded,
					promptTokensBefore: adaptiveMetrics.promptTokensBefore,
					promptTokensAfter: adaptiveMetrics.promptTokensAfter,
					promptSavedTokens: Math.max(
						0,
						adaptiveMetrics.promptTokensBefore - adaptiveMetrics.promptTokensAfter,
					),
				}
			: {}),
		...(toolSelection
			? {
					toolSchemasBefore: toolSelection.totalTools,
					toolSchemasAfter: toolSelection.tools.length,
					toolSchemaTokensBefore: toolSelection.tokensBefore,
					toolSchemaTokensAfter: toolSelection.tokensAfter,
					toolSchemaSelectionReason: toolSelection.reason,
					toolSchemaSelectionConfidence: toolSelection.confidence,
				}
			: {}),
		...(bypassReason ? { bypassReason } : {}),
	};
}

async function optimizeModelInput(
	input: unknown,
	options: LanguageModelWrapperOptions,
): Promise<OptimizedModelInput> {
	if (
		'optimizeMessages' in options &&
		(options as LanguageModelWrapperOptions).optimizeMessages === false
	) {
		const messages = coerceMessages(input);
		return {
			input,
			metrics: optimizationMetrics(messages, messages, options),
			cacheFingerprints: [],
			cacheMetrics: emptyCacheMetrics(),
		};
	}
	if (Array.isArray(input)) {
		const optimized = await optimizeMessages(input, options);
		return {
			input: optimized.messages,
			metrics: optimizationMetrics(
				input,
				optimized.messages,
				options,
				optimized.bypassReason,
				optimized.toolMetrics,
				optimized.cacheMetrics,
				optimized.adaptiveMetrics,
			),
			cacheFingerprints: optimized.cacheFingerprints ?? [],
			cacheMetrics: optimized.cacheMetrics ?? emptyCacheMetrics(),
		};
	}
	if (
		input &&
		typeof input === 'object' &&
		'toChatMessages' in input &&
		typeof (input as { toChatMessages: unknown }).toChatMessages === 'function'
	) {
		const messages = (input as { toChatMessages: () => unknown[] }).toChatMessages();
		const optimized = await optimizeMessages(messages, options);
		return {
			input: optimized.messages,
			metrics: optimizationMetrics(
				messages,
				optimized.messages,
				options,
				optimized.bypassReason,
				optimized.toolMetrics,
				optimized.cacheMetrics,
				optimized.adaptiveMetrics,
			),
			cacheFingerprints: optimized.cacheFingerprints ?? [],
			cacheMetrics: optimized.cacheMetrics ?? emptyCacheMetrics(),
		};
	}
	const singleton = input === undefined || input === null ? [] : [input];
	return {
		input,
		metrics: optimizationMetrics(singleton, singleton, options),
		cacheFingerprints: [],
		cacheMetrics: emptyCacheMetrics(),
	};
}

async function recordProviderCacheEvidence(
	cache: CacheAwareModelOptions | undefined,
	fingerprints: string[],
	response: unknown,
): Promise<void> {
	if (!cache?.registry || fingerprints.length === 0) return;
	const cachedTokens = extractProviderUsage(response).cachedInputTokens;
	if (!cachedTokens) return;
	try {
		await cache.registry.recordProviderCache(fingerprints, cachedTokens);
	} catch {
		// Provider response remains valid even if local cache metadata is unavailable.
	}
}

async function observedCall(
	operation: ModelOptimizationMetrics['operation'],
	optimized: OptimizedModelInput,
	observer: ModelInvocationObserver | undefined,
	cache: CacheAwareModelOptions | undefined,
	call: () => Promise<unknown>,
): Promise<unknown> {
	const metrics = { operation, ...optimized.metrics };
	const traceId = observer?.onStart?.(metrics);
	try {
		const response = await call();
		await recordProviderCacheEvidence(cache, optimized.cacheFingerprints, response);
		observer?.onSuccess?.(traceId, response, metrics);
		return response;
	} catch (error) {
		observer?.onError?.(traceId, error, metrics);
		// Preserve provider error identity; node context converts it after observing the failure.
		// eslint-disable-next-line @n8n/community-nodes/require-node-api-error
		throw error;
	}
}

type ModelInvocationMethod = 'batch' | 'generate' | 'invoke' | 'stream';

function deferredToolBinding(
	model: LanguageModelLike,
	bindArguments: unknown[],
	options: LanguageModelWrapperOptions,
	registry: ToolRegistry,
): object {
	const tools = Array.isArray(bindArguments[0]) ? bindArguments[0] : undefined;
	const fallbackBound = model.bindTools?.(...bindArguments) ?? {};
	if (!tools) return wrapLanguageModel(fallbackBound, options, registry);
	const bindOptions = bindArguments.slice(1);
	const methods = new Set<ModelInvocationMethod>(['batch', 'generate', 'invoke', 'stream']);

	return new Proxy(fallbackBound, {
		get(current, property, receiver) {
			if (
				typeof property === 'string' &&
				methods.has(property as ModelInvocationMethod) &&
				typeof (current as Record<string, unknown>)[property] === 'function'
			) {
				return async (input: unknown, ...callArguments: unknown[]) => {
					const configured = options.toolSelection;
					const effectiveProfile =
						options.adaptiveOptimization === false
							? (options.profile ?? 'balanced')
							: resolveAdaptiveProfile(
									options.profile ?? 'balanced',
									adaptiveRiskSignals(coerceMessages(input), options),
								).effectiveProfile;
					const selection = selectToolSchemas(tools, input, {
						profile: effectiveProfile,
						mode:
							options.cacheAware?.strategy === 'cache_priority'
								? 'disabled'
								: (configured?.mode ?? 'disabled'),
						minimumToolCount: configured?.minimumToolCount ?? 8,
						maximumSelectedTools: configured?.maximumSelectedTools ?? 6,
						tokenBudget: configured?.tokenBudget ?? 3000,
						alwaysAvailableTools: configured?.alwaysAvailableTools ?? [],
						bindOptions,
						registry,
					});
					const selectedBound = selection.keptAll
						? current
						: (model.bindTools?.(selection.tools, ...bindOptions) ?? current);
					const wrapped = wrapLanguageModel(
						selectedBound,
						{ ...options, toolSelectionEvidence: selection },
						registry,
					) as Record<string, unknown>;
					const invocation = wrapped[property];
					if (typeof invocation !== 'function') {
						throw new Error(`Bound model does not implement ${property}`);
					}
					return await (invocation as (value: unknown, ...args: unknown[]) => Promise<unknown>)(
						input,
						...callArguments,
					);
				};
			}
			const value = Reflect.get(current, property, receiver);
			return typeof value === 'function' ? value.bind(current) : value;
		},
	});
}

export function wrapLanguageModel<T extends object>(
	model: T,
	options: LanguageModelWrapperOptions,
	registry = new ToolRegistry(),
): T & LanguageModelLike {
	const target = model as T & LanguageModelLike;
	const observer = options.observer;

	return new Proxy(target, {
		get(current, property, receiver) {
			if (property === 'invoke' && typeof current.invoke === 'function') {
				return async (input: unknown, ...args: unknown[]) => {
					const optimized = await optimizeModelInput(input, options);
					return await observedCall('invoke', optimized, observer, options.cacheAware, async () =>
						current.invoke?.(optimized.input, ...args),
					);
				};
			}
			if (property === 'batch' && typeof current.batch === 'function') {
				return async (inputs: unknown[], ...args: unknown[]) => {
					const optimized = await Promise.all(
						inputs.map(async (input) => await optimizeModelInput(input, options)),
					);
					const combined: OptimizedModelInput = {
						input: optimized.map((entry) => entry.input),
						cacheFingerprints: optimized.flatMap((entry) => entry.cacheFingerprints),
						cacheMetrics: combineCacheMetrics(optimized.map((entry) => entry.cacheMetrics)),
						metrics: optimizationMetrics(
							inputs.flatMap((input) => (Array.isArray(input) ? input : [input])),
							optimized.flatMap((entry) =>
								Array.isArray(entry.input) ? entry.input : [entry.input],
							),
							options,
							undefined,
							combineToolMetrics(optimized.map((entry) => entry.metrics)),
							combineCacheMetrics(optimized.map((entry) => entry.cacheMetrics)),
							combineAdaptiveMetrics(
								optimized.map((entry) =>
									entry.metrics.effectiveProfile
										? {
											profile: {
												selectedProfile:
													(entry.metrics.selectedProfile as AdaptiveProfileResult['selectedProfile']) ??
													'balanced',
												effectiveProfile: entry.metrics
													.effectiveProfile as AdaptiveProfileResult['effectiveProfile'],
												riskLevel: entry.metrics.adaptiveRiskLevel ?? 'low',
												signals: entry.metrics.adaptiveRiskSignals ?? [],
												downgraded: entry.metrics.adaptiveDowngrade ?? false,
											},
											promptTokensBefore: entry.metrics.promptTokensBefore ?? 0,
											promptTokensAfter: entry.metrics.promptTokensAfter ?? 0,
										}
										: undefined,
								),
							),
						),
					};
					return await observedCall('batch', combined, observer, options.cacheAware, async () =>
						current.batch?.(combined.input as unknown[], ...args),
					);
				};
			}
			if (property === 'stream' && typeof current.stream === 'function') {
				return async (input: unknown, ...args: unknown[]) => {
					const optimized = await optimizeModelInput(input, options);
					const metrics = { operation: 'stream' as const, ...optimized.metrics };
					const traceId = observer?.onStart?.(metrics);
					try {
						const response = await current.stream?.(optimized.input, ...args);
						if (!response || typeof response !== 'object' || !(Symbol.asyncIterator in response)) {
							await recordProviderCacheEvidence(
								options.cacheAware,
								optimized.cacheFingerprints,
								response,
							);
							observer?.onSuccess?.(traceId, response, metrics);
							return response;
						}
						const iterable = response as AsyncIterable<unknown>;
						return (async function* observedStream() {
							let lastChunk: unknown;
							try {
								for await (const chunk of iterable) {
									lastChunk = chunk;
									yield chunk;
								}
								await recordProviderCacheEvidence(
									options.cacheAware,
									optimized.cacheFingerprints,
									lastChunk,
								);
								observer?.onSuccess?.(traceId, lastChunk, metrics);
							} catch (error) {
								observer?.onError?.(traceId, error, metrics);
								// Provider errors must retain their identity for the n8n node adapter.
								// eslint-disable-next-line @n8n/community-nodes/require-node-api-error
								throw error;
							}
						})();
					} catch (error) {
						observer?.onError?.(traceId, error, metrics);
						// Preserve provider error identity; node context converts it after observing the failure.
						// eslint-disable-next-line @n8n/community-nodes/require-node-api-error
						throw error;
					}
				};
			}
			if (property === 'generate' && typeof current.generate === 'function') {
				return async (messages: unknown, ...args: unknown[]) => {
					const optimizedGroups = Array.isArray(messages)
						? await Promise.all(
								messages.map(async (entry) =>
									Array.isArray(entry)
										? await optimizeMessages(entry, options)
										: { messages: entry },
								),
							)
						: messages;
					const optimizedMessages = Array.isArray(optimizedGroups)
						? optimizedGroups.map((entry) => entry.messages)
						: optimizedGroups;
					const beforeFlat = Array.isArray(messages)
						? messages.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
						: [messages];
					const afterFlat = Array.isArray(optimizedMessages)
						? optimizedMessages.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
						: [optimizedMessages];
					const optimized: OptimizedModelInput = {
						input: optimizedMessages,
						cacheFingerprints: Array.isArray(optimizedGroups)
							? optimizedGroups.flatMap((entry) => entry.cacheFingerprints ?? [])
							: [],
						cacheMetrics: Array.isArray(optimizedGroups)
							? combineCacheMetrics(
									optimizedGroups.map((entry) => entry.cacheMetrics ?? emptyCacheMetrics()),
								)
							: emptyCacheMetrics(),
						metrics: optimizationMetrics(
							beforeFlat,
							afterFlat,
							options,
							Array.isArray(optimizedGroups)
								? optimizedGroups.find((entry) => entry.bypassReason)?.bypassReason
								: undefined,
							Array.isArray(optimizedGroups)
								? combineToolMetrics(
										optimizedGroups
											.map((entry) => entry.toolMetrics)
											.filter((entry): entry is ToolOptimizationMetrics => Boolean(entry)),
									)
								: undefined,
							Array.isArray(optimizedGroups)
								? combineCacheMetrics(
										optimizedGroups.map((entry) => entry.cacheMetrics ?? emptyCacheMetrics()),
									)
								: undefined,
							Array.isArray(optimizedGroups)
								? combineAdaptiveMetrics(
										optimizedGroups.map((entry) => entry.adaptiveMetrics),
									)
								: undefined,
						),
					};
					return observedCall('generate', optimized, observer, options.cacheAware, async () =>
						current.generate?.(optimized.input, ...args),
					);
				};
			}
			if (property === 'bindTools' && typeof current.bindTools === 'function') {
				return (...args: unknown[]) => {
					if (options.optimizeMessages !== false && options.toolSelection) {
						return deferredToolBinding(current, args, options, registry);
					}
					return wrapLanguageModel(current.bindTools?.(...args) ?? {}, options, registry);
				};
			}
			const value = Reflect.get(current, property, receiver);
			return typeof value === 'function' ? value.bind(current) : value;
		},
	}) as T & LanguageModelLike;
}
