import { describe, expect, it, vi } from 'vitest';
import { optimizeContext } from '../../src/core/optimizer';

const repeatedRag = Array.from(
	{ length: 12 },
	() => 'A betoneira de 400 L está disponível para locação na loja 001.',
).join('\n');

describe('optimizeContext', () => {
	it('preserves the current message and reduces duplicated context', async () => {
		const result = await optimizeContext({
			systemPrompt: 'Atenda em português.\nAtenda em português.\nNunca invente disponibilidade.',
			conversationHistory: [
				{ role: 'user', content: 'Olá' },
				{ role: 'assistant', content: 'Olá! Como posso ajudar?' },
				{ role: 'user', content: 'Preciso de uma betoneira.' },
				{ role: 'assistant', content: 'Para qual período?' },
				{ role: 'user', content: 'Por 3 dias a partir de 21/07/2026.' },
			],
			retrievedContext: repeatedRag,
			toolDefinitions: [{ name: 'consulta_estoque', description: 'Consulta estoque da loja 001.' }],
			currentMessage: 'Pode confirmar o valor de R$ 1.500,00?',
		});

		expect(result.currentMessage).toBe('Pode confirmar o valor de R$ 1.500,00?');
		expect(result.optimization.fallback).toBe(false);
		expect(result.optimization.tokensAfter).toBeLessThan(result.optimization.tokensBefore);
		expect(result.optimizedContext).toContain('21/07/2026');
		expect(result.optimizedContext).toContain('R$ 1.500,00');
		expect(result.optimizedToolDefinitions).toContain('consulta_estoque');
	});

	it('calls the summarizer only above the configured threshold', async () => {
		const summarize = vi.fn(async () => ({
			text: 'Resumo preservado: cliente quer 3 unidades em 21/07/2026.',
			warnings: [],
		}));

		const result = await optimizeContext(
			{
				conversationHistory: repeatedRag.repeat(6),
				currentMessage: 'Continue.',
			},
			{
				profile: 'custom',
				custom: {
					summaryThresholdTokens: 1,
					keepRecentMessages: 1,
				},
			},
			{ summarize },
		);

		expect(summarize).toHaveBeenCalledOnce();
		expect(result.optimization.summaryModelUsed).toBe(true);
	});

	it('fails open when a summary loses a protected fact', async () => {
		const input = {
			conversationHistory: 'Cliente confirmou R$ 2.400,00 para 23/07/2026 às 14:00.'.repeat(20),
			currentMessage: 'Pode seguir.',
		};

		const result = await optimizeContext(
			input,
			{
				profile: 'custom',
				custom: {
					summaryThresholdTokens: 1,
					keepRecentMessages: 1,
				},
			},
			{
				summarize: async () => ({ text: 'Cliente confirmou a proposta.', warnings: [] }),
			},
		);

		expect(result.optimization.fallback).toBe(true);
		expect(result.optimization.fallbackReason).toBe('protected_fact_missing');
		expect(result.optimizedHistory).toBe(input.conversationHistory);
	});

	it('keeps old user corrections, pending questions, and unique context', async () => {
		const history = [
			'Usuário: Olá.',
			'Assistente: Bem-vindo.',
			'Usuário: Na verdade, não quero Campinas; a cidade correta é Jundiaí.',
			'Assistente: Posso confirmar a cidade de interesse?',
			'Assistente: Informação genérica antiga.',
			'Usuário: Certo.',
			'Assistente: Continuando.',
			'Usuário: Pode seguir.',
		].join('\n');
		const result = await optimizeContext(
			{ conversationHistory: history, currentMessage: 'Continue.' },
			{ profile: 'custom', custom: { keepRecentMessages: 2 } },
		);
		expect(result.optimizedHistory).toContain('cidade correta é Jundiaí');
		expect(result.optimizedHistory).toContain('Posso confirmar a cidade de interesse?');
		expect(result.optimizedHistory).toContain('Informação genérica antiga');
	});

	it('never rewrites history containing tool calls or tool results', async () => {
		const history = [
			'{"role":"user","content":"Consulte o pedido"}',
			'{"role":"assistant","tool_calls":[{"id":"call_1","name":"orders"}]}',
			'{"role":"tool","tool_call_id":"call_1","content":"{\\"status\\":\\"open\\"}"}',
		].join('\n');
		const result = await optimizeContext({
			conversationHistory: history,
			currentMessage: 'Qual é o status?',
		});
		expect(result.optimizedHistory).toBe(history);
	});

	it('enforces the configured hard input-token budget', async () => {
		const result = await optimizeContext(
			{
				systemPrompt: 'Responda em português.',
				conversationHistory: 'contexto antigo irrelevante '.repeat(1_000),
				currentMessage: 'Continue.',
			},
			{
				profile: 'custom',
				custom: {
					maxInputTokens: 100,
					summaryThresholdTokens: 10_000,
					keepRecentMessages: 2,
					allowUniqueContentTrimming: true,
				},
			},
		);

		expect(result.optimization.tokensAfter).toBeLessThanOrEqual(100);
		expect(result.optimization.budgetMet).toBe(true);
		expect(result.optimization.warnings).toContain('Context trimmed to the configured token budget.');
	});

	it('does not trim unique content in balanced mode when the budget is exceeded', async () => {
		const uniqueLines = Array.from(
			{ length: 200 },
			(_, index) => `Unique decision ${index}: preserve this business context.`,
		).join('\n');
		const result = await optimizeContext(
			{
				conversationHistory: uniqueLines,
				currentMessage: 'Continue.',
			},
			{
				profile: 'custom',
				custom: {
					maxInputTokens: 50,
					keepRecentMessages: 6,
					allowUniqueContentTrimming: false,
				},
			},
		);

		expect(result.optimizedHistory).toContain('Unique decision 0');
		expect(result.optimizedHistory).toContain('Unique decision 199');
		expect(result.optimization.budgetMet).toBe(false);
		expect(result.optimization.warnings).toContain(
			'Token budget exceeded; unique content was preserved.',
		);
	});
});
