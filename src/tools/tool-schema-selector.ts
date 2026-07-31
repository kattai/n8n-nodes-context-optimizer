import { canonicalProfileName } from '../core/profiles';
import type { OptimizerProfileName } from '../core/types';
import { stableSerialize } from '../context/canonical-context';
import { ToolRegistry, type RegisteredToolSchema } from './tool-registry';

export type ToolSelectionMode = 'automatic' | 'disabled' | 'select_when_safe';
export type ToolSelectionReason =
	| 'disabled'
	| 'duplicate_names'
	| 'low_confidence'
	| 'quality_profile'
	| 'selected'
	| 'structured_output_ambiguous'
	| 'too_few_tools';

export interface ToolSchemaSelectionOptions {
	profile: OptimizerProfileName;
	mode: ToolSelectionMode;
	minimumToolCount: number;
	maximumSelectedTools: number;
	tokenBudget: number;
	alwaysAvailableTools?: string[];
	recentlyUsedTools?: string[];
	bindOptions?: unknown;
	registry?: ToolRegistry;
}

export interface ToolSchemaSelectionResult {
	tools: unknown[];
	totalTools: number;
	selectedNames: string[];
	keptAll: boolean;
	reason: ToolSelectionReason;
	confidence: number;
	tokensBefore: number;
	tokensAfter: number;
}

const stopWords = new Set([
	'a',
	'an',
	'and',
	'as',
	'at',
	'com',
	'da',
	'de',
	'do',
	'e',
	'for',
	'help',
	'i',
	'in',
	'is',
	'me',
	'o',
	'of',
	'on',
	'para',
	'please',
	'por',
	'the',
	'this',
	'to',
	'um',
	'uma',
	'with',
]);

function object(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function words(value: string): string[] {
	return value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length > 1 && !stopWords.has(word));
}

function contentText(value: unknown): string {
	if (typeof value === 'string') return value;
	if (Array.isArray(value)) return value.map(contentText).join(' ');
	const entry = object(value);
	if (entry?.text !== undefined) return contentText(entry.text);
	return value === undefined || value === null ? '' : stableSerialize(value);
}

function messageRole(value: unknown): string {
	const entry = object(value);
	return String(entry?.role ?? entry?.type ?? '').toLowerCase();
}

function toolCallNames(value: unknown): string[] {
	const entry = object(value);
	const additional = object(entry?.additional_kwargs) ?? object(entry?.additionalKwargs);
	const calls = entry?.tool_calls ?? additional?.tool_calls ?? additional?.toolCalls;
	const result: string[] = [];
	for (const rawCall of Array.isArray(calls) ? calls : calls ? [calls] : []) {
		const call = object(rawCall);
		const fn = object(call?.function);
		const name = String(call?.name ?? fn?.name ?? '').trim();
		if (name) result.push(name);
	}
	return result;
}

function modelMessages(input: unknown): unknown[] {
	if (Array.isArray(input)) {
		return input.flatMap((entry) => (Array.isArray(entry) ? modelMessages(entry) : [entry]));
	}
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

function taskAndUsedTools(input: unknown): { task: string; usedTools: string[] } {
	const messages = modelMessages(input);
	const usedTools = messages.flatMap(toolCallNames);
	const conversational = messages.filter((message) => {
		const role = messageRole(message);
		return role === 'human' || role === 'user' || role === '';
	});
	const selected = conversational.slice(-3);
	return {
		task: selected.map((message) => contentText(object(message)?.content ?? message)).join(' '),
		usedTools,
	};
}

function bindOptionsRecord(value: unknown): Record<string, unknown> {
	if (!Array.isArray(value)) return object(value) ?? {};
	return Object.assign({}, ...value.map((entry) => object(entry) ?? {})) as Record<string, unknown>;
}

function forcedToolName(options: Record<string, unknown>): string | undefined {
	const choice = options.tool_choice ?? options.toolChoice;
	if (typeof choice === 'string' && !['auto', 'any', 'none', 'required'].includes(choice)) {
		return choice;
	}
	const choiceRecord = object(choice);
	const fn = object(choiceRecord?.function);
	const name = choiceRecord?.name ?? fn?.name;
	return name === undefined ? undefined : String(name);
}

function structuredOutputAmbiguous(options: Record<string, unknown>): boolean {
	const choice = options.tool_choice ?? options.toolChoice;
	if (choice === 'required' || choice === 'any') return true;
	return [
		'enforceFunctionUsage',
		'includeRaw',
		'ls_structured_output_format',
		'method',
		'response_format',
		'strict',
	].some((key) => options[key] !== undefined);
}

function allTools(
	entries: RegisteredToolSchema[],
	reason: ToolSelectionReason,
	confidence = 0,
): ToolSchemaSelectionResult {
	const tokens = entries.reduce((total, entry) => total + entry.estimatedTokens, 0);
	return {
		tools: entries.map((entry) => entry.tool),
		totalTools: entries.length,
		selectedNames: entries.map((entry) => entry.name),
		keptAll: true,
		reason,
		confidence,
		tokensBefore: tokens,
		tokensAfter: tokens,
	};
}

function entryScore(entry: RegisteredToolSchema, queryWords: Set<string>, task: string): number {
	const normalizedTask = task
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();
	const normalizedName = entry.name.toLowerCase();
	const nameWords = new Set(words(entry.name));
	const descriptionWords = new Set(words(entry.description));
	const schemaWords = new Set(words(entry.schemaText));
	let score = normalizedTask.includes(normalizedName) ? 12 : 0;
	for (const queryWord of queryWords) {
		if (nameWords.has(queryWord)) score += 5;
		else if (descriptionWords.has(queryWord)) score += 3;
		else if (schemaWords.has(queryWord)) score += 1;
	}
	return score;
}

export function selectToolSchemas(
	tools: unknown[],
	input: unknown,
	options: ToolSchemaSelectionOptions,
): ToolSchemaSelectionResult {
	const registry = options.registry ?? new ToolRegistry();
	const entries = registry.register(tools);
	if (options.mode === 'disabled') return allTools(entries, 'disabled');
	if (canonicalProfileName(options.profile) === 'quality') {
		return allTools(entries, 'quality_profile', 1);
	}
	if (entries.length < Math.max(2, options.minimumToolCount)) {
		return allTools(entries, 'too_few_tools', 1);
	}
	if (new Set(entries.map((entry) => entry.name)).size !== entries.length) {
		return allTools(entries, 'duplicate_names');
	}

	const bindOptions = bindOptionsRecord(options.bindOptions);
	if (structuredOutputAmbiguous(bindOptions)) {
		return allTools(entries, 'structured_output_ambiguous');
	}
	const forcedName = forcedToolName(bindOptions);
	const canonicalProfile = canonicalProfileName(options.profile);
	if (canonicalProfile === 'balanced' && options.mode === 'automatic' && !forcedName) {
		return allTools(entries, 'disabled', 1);
	}

	const context = taskAndUsedTools(input);
	registry.markUsed(context.usedTools);
	const queryWords = new Set(words(context.task));
	const requiredNames = new Set([
		...(options.alwaysAvailableTools ?? []),
		...(options.recentlyUsedTools ?? []),
		...registry.recentlyUsed(),
		...context.usedTools,
		...(forcedName ? [forcedName] : []),
	]);
	const byName = new Map(entries.map((entry) => [entry.name, entry]));
	if ([...requiredNames].some((name) => !byName.has(name))) {
		return allTools(entries, 'low_confidence');
	}

	const ranked = entries
		.map((entry) => ({ entry, score: entryScore(entry, queryWords, context.task) }))
		.sort((left, right) => right.score - left.score || left.entry.index - right.entry.index);
	const matchedWords = new Set<string>();
	for (const queryWord of queryWords) {
		if (entries.some((entry) => words(`${entry.name} ${entry.description}`).includes(queryWord))) {
			matchedWords.add(queryWord);
		}
	}
	const coverage = queryWords.size === 0 ? 0 : matchedWords.size / queryWords.size;
	const topScore = ranked[0]?.score ?? 0;
	const confidence = Number(
		Math.min(1, coverage * 0.7 + Math.min(1, topScore / 12) * 0.3).toFixed(3),
	);
	if (!forcedName && (queryWords.size < 2 || topScore < 3 || confidence < 0.35)) {
		return allTools(entries, 'low_confidence', confidence);
	}

	const selected = new Set<RegisteredToolSchema>();
	for (const name of requiredNames) {
		const entry = byName.get(name);
		if (entry) selected.add(entry);
	}
	let selectedTokens = [...selected].reduce((total, entry) => total + entry.estimatedTokens, 0);
	const maximumSelected = Math.max(1, Math.floor(options.maximumSelectedTools));
	const tokenBudget = Math.max(1, Math.floor(options.tokenBudget));
	for (const { entry, score } of ranked) {
		if (score <= 0 || selected.has(entry)) continue;
		if (selected.size >= maximumSelected) break;
		if (selected.size > 0 && selectedTokens + entry.estimatedTokens > tokenBudget) continue;
		selected.add(entry);
		selectedTokens += entry.estimatedTokens;
	}
	if (selected.size === 0) return allTools(entries, 'low_confidence', confidence);

	const selectedEntries = entries.filter((entry) => selected.has(entry));
	const tokensBefore = entries.reduce((total, entry) => total + entry.estimatedTokens, 0);
	const tokensAfter = selectedEntries.reduce((total, entry) => total + entry.estimatedTokens, 0);
	if (selectedEntries.length >= entries.length || tokensAfter >= tokensBefore) {
		return allTools(entries, 'low_confidence', confidence);
	}
	return {
		tools: selectedEntries.map((entry) => entry.tool),
		totalTools: entries.length,
		selectedNames: selectedEntries.map((entry) => entry.name),
		keptAll: false,
		reason: 'selected',
		confidence,
		tokensBefore,
		tokensAfter,
	};
}
