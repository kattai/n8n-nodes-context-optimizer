import { deduplicateUnits } from '../core/deduplicate';
import { optimizeContent } from '../content/optimize-content';
import { extractProtectedFacts } from '../core/protected-facts';
import { resolveProfile } from '../core/profiles';
import { estimateTokens } from '../core/token-estimator';
import type { OptimizeContextOptions } from '../core/types';
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

export type ModelBypassReason =
	| 'tool_sequence_present'
	| 'tool_sequence_content_only'
	| ToolSequenceIssue;

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
	bypassReason?: ModelBypassReason;
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
}

interface OptimizedModelInput {
	input: unknown;
	metrics: Omit<ModelOptimizationMetrics, 'operation'>;
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
		return parts.every((part): part is string => part !== undefined)
			? parts.join('\n')
			: undefined;
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
	const user = [...messages]
		.reverse()
		.find((raw) => messageRole(raw as MessageLike) === 'user') as MessageLike | undefined;
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

function combineToolMetrics(
	metrics: Array<Pick<ModelOptimizationMetrics,
		| 'eligibleTokensBefore'
		| 'eligibleTokensAfter'
		| 'virtualizedResourceIds'
		| 'retrievalRequired'
		| 'targetBandReached'
		| 'targetNotReachedReason'
		| 'storageFallbackUsed'>>,
): ToolOptimizationMetrics {
	const combined = emptyToolMetrics();
	for (const entry of metrics) {
		combined.eligibleTokensBefore += entry.eligibleTokensBefore;
		combined.eligibleTokensAfter += entry.eligibleTokensAfter;
		combined.virtualizedResourceIds.push(...entry.virtualizedResourceIds);
		combined.retrievalRequired ||= entry.retrievalRequired;
		combined.targetBandReached ||= entry.targetBandReached;
		combined.storageFallbackUsed ||= entry.storageFallbackUsed;
		if (entry.targetNotReachedReason) combined.targetNotReachedReason = entry.targetNotReachedReason;
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
): Promise<{ messages: unknown[]; changed: boolean; metrics: ToolOptimizationMetrics }> {
	let changed = false;
	const metrics = emptyToolMetrics(
		options.profile === 'aggressive' && !options.maximumSavings
			? 'virtualization_not_configured'
			: undefined,
	);
	const currentTask = taskText(messages);
	const optimized: unknown[] = [];
	for (const raw of messages) {
		const message = raw as MessageLike;
		if (messageRole(message) !== 'tool') {
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
		if (options.profile === 'aggressive' && options.maximumSavings) {
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
		}
		if (content === toolText) {
			optimized.push(raw);
			continue;
		}
		changed = true;
		optimized.push(cloneWithContent(message, content));
	}
	if (metrics.eligibleTokensBefore > 0) {
		metrics.targetBandReached =
			metrics.eligibleTokensAfter <= metrics.eligibleTokensBefore * 0.3;
		if (metrics.targetBandReached) delete metrics.targetNotReachedReason;
	}
	return { messages: changed ? optimized : messages, changed, metrics };
}

async function optimizeMessages(
	messages: unknown[],
	options: LanguageModelWrapperOptions,
): Promise<OptimizedMessages> {
	const toolSequence = analyzeToolSequence(messages);
	if (toolSequence.hasToolData) {
		if (toolSequence.valid) {
			const optimized = await optimizeToolResults(messages, options);
			return {
				messages: optimized.messages,
				bypassReason: optimized.changed
					? 'tool_sequence_content_only'
					: 'tool_sequence_present',
				toolMetrics: optimized.metrics,
			};
		}
		return {
			messages,
			bypassReason: toolSequence.issue,
		};
	}

	const profile = resolveProfile(options.profile ?? 'balanced', options.custom);
	const entries = messages.map((message, index) => {
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
		const next = deduplicateUnits(
			[...acceptedRegularTexts, key],
			profile.approximateDeduplication,
		);
		if (next.length === acceptedRegularTexts.length) continue;
		acceptedRegularTexts.push(key);
		acceptedRegularIndexes.add(entry.index);
	}

	const kept = entries.filter((entry) => {
		if (structurallyProtected.has(entry.index)) return true;
		return acceptedRegularIndexes.has(entry.index);
	});

	if (kept.length === 0 && entries.length > 0) {
		return { messages: [entries[entries.length - 1].message] };
	}
	return { messages: kept.map((entry) => entry.message) };
}

function optimizationMetrics(
	before: unknown[],
	after: unknown[],
	options: OptimizeContextOptions,
	bypassReason?: ModelBypassReason,
	toolMetrics = emptyToolMetrics(),
): Omit<ModelOptimizationMetrics, 'operation'> {
	const beforeText = before.map((message) => messageText(message as MessageLike)).join('\n');
	const afterText = after.map((message) => messageText(message as MessageLike)).join('\n');
	const tokensBeforeEstimated = estimateTokens(beforeText);
	const tokensAfterEstimated = estimateTokens(afterText);
	const savingsTokensEstimated = Math.max(0, tokensBeforeEstimated - tokensAfterEstimated);
	return {
		profile:
			'optimizeMessages' in options &&
			(options as LanguageModelWrapperOptions).optimizeMessages === false
				? 'measure_only'
				: resolveProfile(options.profile ?? 'balanced', options.custom).name,
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
		const messages = Array.isArray(input)
			? input
			: input &&
				  typeof input === 'object' &&
				  'toChatMessages' in input &&
				  typeof (input as { toChatMessages: unknown }).toChatMessages === 'function'
				? (input as { toChatMessages: () => unknown[] }).toChatMessages()
				: input === undefined || input === null
					? []
					: [input];
		return {
			input,
			metrics: optimizationMetrics(messages, messages, options),
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
			),
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
			),
		};
	}
	const singleton = input === undefined || input === null ? [] : [input];
	return { input, metrics: optimizationMetrics(singleton, singleton, options) };
}

async function observedCall(
	operation: ModelOptimizationMetrics['operation'],
	optimized: OptimizedModelInput,
	observer: ModelInvocationObserver | undefined,
	call: () => Promise<unknown>,
): Promise<unknown> {
	const metrics = { operation, ...optimized.metrics };
	const traceId = observer?.onStart?.(metrics);
	try {
		const response = await call();
		observer?.onSuccess?.(traceId, response, metrics);
		return response;
	} catch (error) {
		observer?.onError?.(traceId, error, metrics);
		// Preserve provider error identity; node context converts it after observing the failure.
		// eslint-disable-next-line @n8n/community-nodes/require-node-api-error
		throw error;
	}
}

export function wrapLanguageModel<T extends object>(
	model: T,
	options: LanguageModelWrapperOptions,
): T & LanguageModelLike {
	const target = model as T & LanguageModelLike;
	const observer = options.observer;

	return new Proxy(target, {
		get(current, property, receiver) {
			if (property === 'invoke' && typeof current.invoke === 'function') {
				return async (input: unknown, ...args: unknown[]) => {
					const optimized = await optimizeModelInput(input, options);
					return await observedCall('invoke', optimized, observer, async () =>
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
						metrics: optimizationMetrics(
							inputs.flatMap((input) => (Array.isArray(input) ? input : [input])),
							optimized.flatMap((entry) =>
								Array.isArray(entry.input) ? entry.input : [entry.input],
							),
							options,
							undefined,
							combineToolMetrics(optimized.map((entry) => entry.metrics)),
						),
					};
					return await observedCall('batch', combined, observer, async () =>
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
						if (
							!response ||
							typeof response !== 'object' ||
							!(Symbol.asyncIterator in response)
						) {
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
						),
					};
					return observedCall('generate', optimized, observer, async () =>
						current.generate?.(optimized.input, ...args),
					);
				};
			}
			if (property === 'bindTools' && typeof current.bindTools === 'function') {
				return (...args: unknown[]) => wrapLanguageModel(current.bindTools?.(...args) ?? {}, options);
			}
			const value = Reflect.get(current, property, receiver);
			return typeof value === 'function' ? value.bind(current) : value;
		},
	}) as T & LanguageModelLike;
}
