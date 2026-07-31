import { describe, expect, it } from 'vitest';
import { calculateNetSavings, countTokens } from '../../src/tokens/token-counter';

describe('model-aware token counter', () => {
	it('always prefers provider-reported usage', () => {
		const result = countTokens('A text whose estimate does not matter.', {
			model: 'gemini-2.5-flash',
			providerActualTokens: 123,
		});

		expect(result).toMatchObject({
			tokens: 123,
			method: 'provider_actual',
			confidence: 'exact',
			family: 'gemini',
		});
	});

	it('uses an exact local adapter when one supports the selected model', () => {
		const result = countTokens('hello', {
			model: 'gpt-test',
			adapters: [
				{
					name: 'test-adapter',
					supports: (model) => model === 'gpt-test',
					count: () => 7,
				},
			],
		});

		expect(result).toMatchObject({
			tokens: 7,
			method: 'exact_adapter',
			confidence: 'exact',
		});
	});

	it.each([
		['gpt-5', 'openai'],
		['claude-sonnet-4', 'anthropic'],
		['gemini-2.5-flash', 'gemini'],
		['llama-3.3', 'llama'],
		['mistral-large', 'mistral'],
	] as const)('calibrates estimates for %s', (model, family) => {
		const result = countTokens('Texto multilíngue with punctuation: 123!', { model });
		expect(result.family).toBe(family);
		expect(result.method).toBe('calibrated_estimate');
		expect(result.tokens).toBeGreaterThan(0);
	});

	it('supports a custom chars-per-token ratio', () => {
		const result = countTokens('123456789012', { charsPerToken: 3 });
		expect(result).toMatchObject({ method: 'custom_ratio', family: 'custom' });
		expect(result.tokens).toBeGreaterThanOrEqual(4);
	});
});

describe('net token savings', () => {
	it('includes compressor, retrieval and verification overhead', () => {
		expect(
			calculateNetSavings({
				originalTokens: 10_000,
				sentTokens: 4_000,
				compressorTokens: 500,
				retrievedTokens: 700,
				verificationTokens: 300,
			}),
		).toMatchObject({
			grossTokens: 6_000,
			overheadTokens: 1_500,
			netTokens: 4_500,
			netPercent: 45,
			useOptimized: true,
		});
	});

	it('rejects an optimization with negative net savings', () => {
		expect(
			calculateNetSavings({
				originalTokens: 1_000,
				sentTokens: 800,
				compressorTokens: 300,
			}),
		).toMatchObject({
			netTokens: -100,
			useOptimized: false,
			reason: 'negative_net_savings',
		});
	});
});
