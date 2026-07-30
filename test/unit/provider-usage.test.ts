import { describe, expect, it } from 'vitest';
import { extractProviderUsage } from '../../src/analytics/provider-usage';

describe('provider usage normalization', () => {
	it.each([
		[
			'OpenAI-compatible',
			{ usage_metadata: { input_tokens: 120, output_tokens: 30, total_tokens: 150 } },
		],
		[
			'Anthropic',
			{ response_metadata: { usage: { input_tokens: 220, output_tokens: 40 } } },
		],
		[
			'Gemini',
			{
				response_metadata: {
					usageMetadata: {
						promptTokenCount: 320,
						candidatesTokenCount: 50,
						totalTokenCount: 370,
						cachedContentTokenCount: 20,
					},
				},
			},
		],
		[
			'n8n llmOutput',
			{ llmOutput: { tokenUsage: { promptTokens: 420, completionTokens: 60, totalTokens: 480 } } },
		],
		['Ollama', { usage: { prompt_eval_count: 520, eval_count: 70 } }],
	])('normalizes %s metadata', (_name, response) => {
		const usage = extractProviderUsage(response);

		expect(usage.available).toBe(true);
		expect(usage.inputTokens).toBeGreaterThan(0);
		expect(usage.outputTokens).toBeGreaterThan(0);
	});

	it('returns unavailable without inventing usage', () => {
		expect(extractProviderUsage({ content: 'ok' })).toEqual({ available: false });
	});

	it.each([
		[
			'OpenAI nested details',
			{ usage_metadata: { input_tokens: 500, input_token_details: { cached_tokens: 320 } } },
		],
		[
			'Anthropic cache read',
			{ response_metadata: { usage: { input_tokens: 500, cache_read_input_tokens: 330 } } },
		],
		[
			'Gemini cached content',
			{ response_metadata: { usageMetadata: { promptTokenCount: 500, cachedContentTokenCount: 340 } } },
		],
	])('extracts cached input from %s', (_name, response) => {
		expect(extractProviderUsage(response).cachedInputTokens).toBeGreaterThanOrEqual(320);
	});
});
