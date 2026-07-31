import { detectModelFamily } from './model-detector';
import type {
	NetSavingsInput,
	NetSavingsResult,
	TokenCountOptions,
	TokenCountResult,
	TokenModelFamily,
} from './types';

const charsPerTokenByFamily: Record<Exclude<TokenModelFamily, 'custom'>, number> = {
	openai: 3.8,
	anthropic: 3.6,
	gemini: 4,
	llama: 3.5,
	mistral: 3.5,
	generic: 4,
};

function finiteNonNegative(value: unknown): number | undefined {
	const numeric = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
}

function lexicalEstimate(text: string): number {
	const units = text.match(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
	return Math.ceil(units.length * 1.12);
}

export function countTokens(text: string, options: TokenCountOptions = {}): TokenCountResult {
	const model = String(options.model ?? '').trim();
	const family = detectModelFamily(model);
	const actual = finiteNonNegative(options.providerActualTokens);
	if (actual !== undefined) {
		return {
			tokens: Math.round(actual),
			method: 'provider_actual',
			confidence: 'exact',
			family,
			...(model ? { model } : {}),
		};
	}

	if (model) {
		for (const adapter of options.adapters ?? []) {
			if (!adapter.supports(model)) continue;
			const tokens = finiteNonNegative(adapter.count(text, model));
			if (tokens !== undefined) {
				return {
					tokens: Math.round(tokens),
					method: 'exact_adapter',
					confidence: 'exact',
					family,
					model,
				};
			}
		}
	}

	if (!text) {
		return {
			tokens: 0,
			method: options.charsPerToken ? 'custom_ratio' : 'generic_estimate',
			confidence: options.charsPerToken ? 'medium' : 'low',
			family: options.charsPerToken ? 'custom' : family,
			...(model ? { model } : {}),
		};
	}

	const customRatio = finiteNonNegative(options.charsPerToken);
	const ratio = customRatio && customRatio > 0 ? customRatio : charsPerTokenByFamily[family];
	const characterEstimate = Math.ceil(text.length / ratio);
	const lexical = lexicalEstimate(text);
	const tokens = customRatio
		? Math.max(1, characterEstimate)
		: Math.max(1, Math.round(characterEstimate * 0.65 + lexical * 0.35));
	return {
		tokens,
		method: customRatio ? 'custom_ratio' : model ? 'calibrated_estimate' : 'generic_estimate',
		confidence: customRatio ? 'medium' : model ? 'medium' : 'low',
		family: customRatio ? 'custom' : family,
		...(model ? { model } : {}),
	};
}

export function calculateNetSavings(input: NetSavingsInput): NetSavingsResult {
	const originalTokens = Math.max(0, input.originalTokens);
	const sentTokens = Math.max(0, input.sentTokens);
	const grossTokens = originalTokens - sentTokens;
	const overheadTokens =
		Math.max(0, input.compressorTokens ?? 0) +
		Math.max(0, input.retrievedTokens ?? 0) +
		Math.max(0, input.verificationTokens ?? 0);
	const netTokens = grossTokens - overheadTokens;
	const minimum = Math.max(0, input.minimumNetSavingsTokens ?? 1);
	const positive = netTokens > 0;
	const useOptimized = positive && netTokens >= minimum;
	return {
		grossTokens,
		overheadTokens,
		netTokens,
		netPercent: originalTokens === 0 ? 0 : Number(((netTokens / originalTokens) * 100).toFixed(2)),
		positive,
		useOptimized,
		...(!positive
			? { reason: 'negative_net_savings' as const }
			: !useOptimized
				? { reason: 'minimum_net_savings_not_met' as const }
				: {}),
	};
}
