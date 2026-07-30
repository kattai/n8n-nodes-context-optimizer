import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { wrapLanguageModel } from '../../src/model-wrapper/wrap-language-model';
import { retrieveContext } from '../../src/retrieval/retrieve-context';
import { FileSystemResourceStore } from '../../src/storage/filesystem-store';

class FakeModel {
	public lastInput: unknown;

	async invoke(input: unknown) {
		this.lastInput = input;
		return { content: 'ok', usage_metadata: { input_tokens: 10, output_tokens: 1 } };
	}

	async *stream(input: unknown) {
		this.lastInput = input;
		yield { content: 'ok' };
	}

	bindTools() {
		return new FakeModel();
	}
}

describe('wrapLanguageModel', () => {
	it('measures a baseline without changing or deduplicating messages', async () => {
		const model = new FakeModel();
		const starts: unknown[] = [];
		const messages = [
			{ role: 'human', content: 'Mesmo texto' },
			{ role: 'assistant', content: 'REGISTRADO.' },
			{ role: 'human', content: 'Mesmo texto' },
		];
		const wrapped = wrapLanguageModel(model, {
			profile: 'balanced',
			optimizeMessages: false,
			observer: {
				onStart(metrics) {
					starts.push(metrics);
				},
			},
		});

		await wrapped.invoke(messages);

		expect(model.lastInput).toBe(messages);
		expect(starts[0]).toMatchObject({
			profile: 'measure_only',
			messagesBefore: 3,
			messagesAfter: 3,
			savingsTokensEstimated: 0,
		});
	});

	it('optimizes model messages and preserves the latest user message', async () => {
		const model = new FakeModel();
		const wrapped = wrapLanguageModel(model, { profile: 'balanced' });
		const messages = [
			{ role: 'system', content: 'Atenda em português.' },
			{ role: 'human', content: 'ok' },
			{ role: 'assistant', content: 'Certo.' },
			{ role: 'human', content: 'ok' },
			{ role: 'assistant', content: 'Certo.' },
			{ role: 'human', content: 'Mensagem única 1.' },
			{ role: 'assistant', content: 'Mensagem única 2.' },
			{ role: 'human', content: 'Mensagem única 3.' },
			{ role: 'assistant', content: 'Mensagem única 4.' },
			{ role: 'human', content: 'Mensagem única 5.' },
			{ role: 'assistant', content: 'Mensagem única 6.' },
			{ role: 'human', content: 'Quero 3 unidades em 21/07/2026.' },
		];

		await wrapped.invoke(messages);

		expect(Array.isArray(model.lastInput)).toBe(true);
		const optimized = model.lastInput as Array<{ content: string }>;
		expect(optimized.at(-1)?.content).toBe('Quero 3 unidades em 21/07/2026.');
		expect(optimized.length).toBeLessThan(messages.length);
	});

	it('keeps every message inside the configured recent window even when duplicated', async () => {
		const model = new FakeModel();
		const wrapped = wrapLanguageModel(model, {
			profile: 'custom',
			custom: {
				keepRecentMessages: 4,
				approximateDeduplication: true,
			},
		});
		const recent = [
			{ role: 'human', content: 'ok' },
			{ role: 'assistant', content: 'certo' },
			{ role: 'human', content: 'ok' },
			{ role: 'assistant', content: 'certo' },
		];
		const messages = [
			{ role: 'human', content: 'contexto antigo' },
			{ role: 'assistant', content: 'registrado' },
			...recent,
		];

		await wrapped.invoke(messages);

		const optimized = model.lastInput as Array<{ role: string; content: string }>;
		expect(optimized.slice(-4)).toEqual(recent);
	});

	it('makes maximum quality more conservative than balanced on the same history', async () => {
		const history = Array.from({ length: 14 }, (_, index) => ({
			role: index % 2 === 0 ? 'human' : 'assistant',
			content: index < 8 ? `old-${index % 2}` : `recent-${index % 2}`,
		}));
		const qualityModel = new FakeModel();
		const balancedModel = new FakeModel();

		await wrapLanguageModel(qualityModel, { profile: 'safe' }).invoke(history);
		await wrapLanguageModel(balancedModel, { profile: 'balanced' }).invoke(history);

		expect((qualityModel.lastInput as unknown[]).length).toBeGreaterThan(
			(balancedModel.lastInput as unknown[]).length,
		);
	});

	it('wraps models returned by bindTools', async () => {
		const wrapped = wrapLanguageModel(new FakeModel(), { profile: 'safe' });
		const bound = wrapped.bindTools([]);

		expect(bound).not.toBeNull();
		expect(typeof bound.invoke).toBe('function');
	});

	it('never removes the latest message when it resembles an older message', async () => {
		const model = new FakeModel();
		const wrapped = wrapLanguageModel(model, { profile: 'balanced' });
		const latest = { role: 'human', content: 'Quero uma betoneira agora!' };
		const messages = [
			{ role: 'human', content: 'Quero uma betoneira agora' },
			{ role: 'assistant', content: 'Certo.' },
			latest,
		];

		await wrapped.invoke(messages);

		const optimized = model.lastInput as Array<{ content: string }>;
		expect(optimized.at(-1)).toBe(latest);
	});

	it('preserves tool calls and their results as complete pairs', async () => {
		const model = new FakeModel();
		const wrapped = wrapLanguageModel(model, { profile: 'aggressive' });
		const messages = [
			{ role: 'system', content: 'Use as ferramentas disponíveis.' },
			{
				role: 'assistant',
				content: '',
				tool_calls: [{ id: 'call-1', name: 'consulta_estoque', args: { item: 'betoneira' } }],
			},
			{ role: 'tool', tool_call_id: 'call-1', content: 'Betoneira disponível.' },
			{
				role: 'assistant',
				content: '',
				tool_calls: [{ id: 'call-2', name: 'consultar_carrinho', args: {} }],
			},
			{ role: 'tool', tool_call_id: 'call-2', content: 'Carrinho vazio.' },
			{ role: 'human', content: 'Pode continuar.' },
		];

		await wrapped.invoke(messages);

		expect(model.lastInput).toBe(messages);
	});

	it('bypasses optimization when LangChain stores tool calls in additional_kwargs', async () => {
		const model = new FakeModel();
		const starts: unknown[] = [];
		const wrapped = wrapLanguageModel(model, {
			profile: 'aggressive',
			observer: {
				onStart(metrics) {
					starts.push(metrics);
				},
			},
		});
		const messages = [
			{ role: 'system', content: 'Use tools.' },
			{ role: 'human', content: 'Consulte estoque.' },
			{
				role: 'assistant',
				content: '',
				additional_kwargs: {
					tool_calls: [{ id: 'call-1', function: { name: 'consulta_estoque' } }],
				},
			},
			{ role: 'tool', tool_call_id: 'call-1', content: 'DisponÃ­vel.' },
		];

		await wrapped.invoke(messages);

		expect(model.lastInput).toBe(messages);
		expect(starts[0]).toMatchObject({
			messagesBefore: 4,
			messagesAfter: 4,
			bypassReason: 'tool_sequence_present',
		});
	});

	it('bypasses an invalid tool sequence without changing provider input', async () => {
		const model = new FakeModel();
		const starts: unknown[] = [];
		const wrapped = wrapLanguageModel(model, {
			profile: 'balanced',
			observer: {
				onStart(metrics) {
					starts.push(metrics);
				},
			},
		});
		const messages = [
			{ role: 'system', content: 'Use tools.' },
			{
				role: 'assistant',
				content: '',
				tool_calls: [{ id: 'call-1', name: 'consulta_estoque' }],
			},
			{ role: 'tool', tool_call_id: 'call-1', content: 'DisponÃ­vel.' },
		];

		await wrapped.invoke(messages);

		expect(model.lastInput).toBe(messages);
		expect(starts[0]).toMatchObject({
			bypassReason: 'assistant_tool_call_without_user_or_tool_before',
		});
	});

	it('compresses a large tool result without changing message order or tool metadata', async () => {
		const model = new FakeModel();
		const starts: unknown[] = [];
		const wrapped = wrapLanguageModel(model, {
			profile: 'balanced',
			observer: {
				onStart(metrics) {
					starts.push(metrics);
				},
			},
		});
		const toolResult = {
			role: 'tool',
			tool_call_id: 'call-1',
			content: JSON.stringify(
				Array.from({ length: 80 }, (_, index) => ({
					id: `ORDER-${index}`,
					status: 'open',
					department: 'expansion',
				})),
			),
		};
		const messages = [
			{ role: 'human', content: 'Consulte os pedidos.' },
			{
				role: 'assistant',
				content: '',
				tool_calls: [{ id: 'call-1', name: 'orders' }],
			},
			toolResult,
		];

		await wrapped.invoke(messages);

		const optimized = model.lastInput as typeof messages;
		expect(optimized).toHaveLength(messages.length);
		expect(optimized[0]).toBe(messages[0]);
		expect(optimized[1]).toBe(messages[1]);
		expect(optimized[2].tool_call_id).toBe('call-1');
		expect(optimized[2].content).toContain('@json-table');
		expect(optimized[2].content).toContain('ORDER-79');
		expect(starts[0]).toMatchObject({
			bypassReason: 'tool_sequence_content_only',
			messagesBefore: 3,
			messagesAfter: 3,
		});
		expect(
			(starts[0] as { tokensAfterEstimated: number }).tokensAfterEstimated,
		).toBeLessThan((starts[0] as { tokensBeforeEstimated: number }).tokensBeforeEstimated);
	});

	it('compresses text-block tool results emitted by current LangChain adapters', async () => {
		const model = new FakeModel();
		const starts: unknown[] = [];
		const wrapped = wrapLanguageModel(model, {
			profile: 'balanced',
			observer: {
				onStart(metrics) {
					starts.push(metrics);
				},
			},
		});
		const content = JSON.stringify({
			records: Array.from({ length: 80 }, (_, index) => ({
				lead_identifier: `LEAD-${index}`,
				status: 'qualification',
				team: 'expansion',
			})),
		});
		const messages = [
			{ role: 'human', content: 'Consulte o lead.' },
			{
				role: 'assistant',
				content: '',
				tool_calls: [{ id: 'call-1', name: 'leads' }],
			},
			{
				role: 'tool',
				tool_call_id: 'call-1',
				content: [{ type: 'text', text: content }],
			},
		];

		await wrapped.invoke(messages);

		const optimized = model.lastInput as Array<{ content: unknown; tool_call_id?: string }>;
		expect(optimized).toHaveLength(messages.length);
		expect(optimized[2].tool_call_id).toBe('call-1');
		expect(optimized[2].content).toEqual(expect.stringContaining('@json-table'));
		expect(optimized[2].content).toEqual(expect.stringContaining('LEAD-79'));
		expect(starts[0]).toMatchObject({ bypassReason: 'tool_sequence_content_only' });
	});

	it('compresses structured tool response envelopes without exposing the wrapper', async () => {
		const model = new FakeModel();
		const wrapped = wrapLanguageModel(model, { profile: 'balanced' });
		const response = JSON.stringify({
			records: Array.from({ length: 80 }, (_, index) => ({
				lead_identifier: `LEAD-${index}`,
				status: 'qualification',
				team: 'expansion',
			})),
		});
		const messages = [
			{ role: 'human', content: 'Consulte o lead.' },
			{
				role: 'assistant',
				content: '',
				tool_calls: [{ id: 'call-1', name: 'leads' }],
			},
			{
				role: 'tool',
				tool_call_id: 'call-1',
				content: { response },
			},
		];

		await wrapped.invoke(messages);

		const optimized = model.lastInput as Array<{ content: unknown }>;
		expect(optimized[2].content).toEqual(expect.stringContaining('@json-table'));
		expect(optimized[2].content).toEqual(expect.stringContaining('LEAD-79'));
	});

	it('virtualizes eligible tool results by at least 70% and keeps exact retrieval', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'token-saver-model-'));
		try {
			const store = new FileSystemResourceStore(directory);
			const model = new FakeModel();
			const starts: Array<Record<string, unknown>> = [];
			const rows = Array.from({ length: 240 }, (_, index) => ({
				leadId: `LEAD-${index}`,
				city: index === 165 ? 'Campinas' : `Cidade ${index}`,
				capital: 1_000_000 + index,
				status: 'qualification',
				notes: 'Contexto comercial detalhado e repetitivo para qualificação do lead. '.repeat(3),
			}));
			const messages = [
				{ role: 'human', content: 'Localize os dados exatos do LEAD-165.' },
				{
					role: 'assistant',
					content: '',
					tool_calls: [{ id: 'call-165', name: 'list_leads', args: { leadId: 'LEAD-165' } }],
				},
				{
					role: 'tool',
					tool_call_id: 'call-165',
					content: JSON.stringify({ source: 'crm', records: rows }),
				},
			];
			const wrapped = wrapLanguageModel(model, {
				profile: 'aggressive',
				maximumSavings: {
					retrieverAvailable: true,
					store,
					scope: 'workflow-1',
					ttlSeconds: 3600,
					thresholdTokens: 2000,
					targetPreviewRatio: 0.2,
					maxPreviewRatio: 0.3,
					allowSecretLikeContent: false,
				},
				observer: {
					onStart(metrics) {
						starts.push(metrics as unknown as Record<string, unknown>);
					},
				},
			});

			await wrapped.invoke(messages);

			const optimized = model.lastInput as typeof messages;
			const receipt = optimized[2].content;
			expect(receipt).toContain('<context-resource');
			expect(receipt).toContain('LEAD-165');
			expect(optimized.map((message) => message.role)).toEqual(
				messages.map((message) => message.role),
			);
			expect(optimized[1].tool_calls).toEqual(messages[1].tool_calls);
			expect(optimized[2].tool_call_id).toBe('call-165');
			expect(starts[0]).toMatchObject({
				retrievalRequired: true,
				targetBandReached: true,
				storageFallbackUsed: false,
			});
			expect(Number(starts[0].eligibleSavingsPercent)).toBeGreaterThanOrEqual(70);
			expect(Number(starts[0].eligibleTokensAfter)).toBeLessThanOrEqual(
				Number(starts[0].eligibleTokensBefore) * 0.3,
			);

			const resourceId = /id="(ctx_[a-f0-9]+)"/.exec(receipt)?.[1];
			expect(resourceId).toBeTruthy();
			const exact = await retrieveContext(
				store,
				{
					operation: 'get_exact_value',
					resourceId: resourceId ?? '',
					path: 'records[165].capital',
				},
				{
					scope: 'workflow-1',
					maxResults: 20,
					maxTokens: 4000,
					allowedFields: [],
					blockedFields: [],
					allowFullOriginal: false,
				},
			);
			expect(exact).toMatchObject({ ok: true, exact: true, data: 1_000_165 });
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('falls back to structural compression when exact retrieval is unavailable', async () => {
		const model = new FakeModel();
		const starts: Array<Record<string, unknown>> = [];
		const content = JSON.stringify(
			Array.from({ length: 240 }, (_, index) => ({
				id: `ORDER-${index}`,
				status: 'open',
				description: 'Repeated operational context '.repeat(8),
			})),
		);
		const wrapped = wrapLanguageModel(model, {
			profile: 'aggressive',
			maximumSavings: {
				retrieverAvailable: false,
				scope: 'workflow-1',
				ttlSeconds: 3600,
				thresholdTokens: 2000,
				targetPreviewRatio: 0.2,
				maxPreviewRatio: 0.3,
				allowSecretLikeContent: false,
			},
			observer: { onStart: (metrics) => starts.push(metrics as unknown as Record<string, unknown>) },
		});

		await wrapped.invoke([
			{ role: 'human', content: 'Consulte pedidos.' },
			{ role: 'assistant', content: '', tool_calls: [{ id: 'call-1', name: 'orders' }] },
			{ role: 'tool', tool_call_id: 'call-1', content },
		]);

		const optimized = model.lastInput as Array<{ content: string }>;
		expect(optimized[2].content).toContain('@json-table');
		expect(optimized[2].content).not.toContain('<context-resource');
		expect(starts[0]).toMatchObject({
			retrievalRequired: false,
			targetBandReached: false,
			targetNotReachedReason: 'retriever_not_connected',
			storageFallbackUsed: true,
		});
	});

	it('does not store secret-like tool results without explicit opt-in', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'token-saver-secret-'));
		try {
			const model = new FakeModel();
			const starts: Array<Record<string, unknown>> = [];
			const wrapped = wrapLanguageModel(model, {
				profile: 'aggressive',
				maximumSavings: {
					retrieverAvailable: true,
					store: new FileSystemResourceStore(directory),
					scope: 'workflow-1',
					ttlSeconds: 3600,
					thresholdTokens: 100,
					targetPreviewRatio: 0.2,
					maxPreviewRatio: 0.3,
					allowSecretLikeContent: false,
				},
				observer: { onStart: (metrics) => starts.push(metrics as unknown as Record<string, unknown>) },
			});
			const content = JSON.stringify(
				Array.from({ length: 80 }, (_, index) => ({
					id: index,
					apiKey: `sk-secret-${index}`,
					description: 'Sensitive context '.repeat(10),
				})),
			);

			await wrapped.invoke([
				{ role: 'human', content: 'Inspecione.' },
				{ role: 'assistant', content: '', tool_calls: [{ id: 'call-secret', name: 'inspect' }] },
				{ role: 'tool', tool_call_id: 'call-secret', content },
			]);

			const optimized = model.lastInput as Array<{ content: string }>;
			expect(optimized[2].content).not.toContain('<context-resource');
			expect(starts[0]).toMatchObject({
				targetNotReachedReason: 'secret_like_content',
				storageFallbackUsed: true,
			});
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('reports content-free optimization metrics and provider response', async () => {
		const model = new FakeModel();
		const starts: unknown[] = [];
		const successes: unknown[] = [];
		const wrapped = wrapLanguageModel(model, {
			profile: 'balanced',
			observer: {
				onStart(metrics) {
					starts.push(metrics);
					return 7;
				},
				onSuccess(traceId, response, metrics) {
					successes.push({ traceId, response, metrics });
				},
			},
		});

		await wrapped.invoke([
			{ role: 'human', content: 'Mesmo texto' },
			{ role: 'assistant', content: 'Certo' },
			{ role: 'human', content: 'Mesmo texto' },
		]);

		expect(starts).toHaveLength(1);
		expect(starts[0]).toMatchObject({
			operation: 'invoke',
			profile: 'balanced',
			messagesBefore: 3,
			messagesAfter: 3,
			tokensAreEstimated: true,
		});
		expect(JSON.stringify(starts[0])).not.toContain('Mesmo texto');
		expect(successes).toHaveLength(1);
		expect(successes[0]).toMatchObject({
			traceId: 7,
			response: { usage_metadata: { input_tokens: 10, output_tokens: 1 } },
		});
	});

	it('preserves old unique conversational facts in balanced mode', async () => {
		const model = new FakeModel();
		const wrapped = wrapLanguageModel(model, { profile: 'balanced' });
		const messages = [
			{ role: 'human', content: 'Minha cor favorita é azul.' },
			{ role: 'assistant', content: 'Entendido.' },
			{ role: 'human', content: 'Vamos falar de franquias.' },
			{ role: 'assistant', content: 'Claro.' },
			{ role: 'human', content: 'Tenho interesse em Campinas.' },
			{ role: 'assistant', content: 'Anotado.' },
			{ role: 'human', content: 'Quero investir este ano.' },
			{ role: 'human', content: 'Qual é minha cor favorita?' },
		];

		await wrapped.invoke(messages);

		expect(model.lastInput).toEqual(messages);
	});

	it('reports stream success only after the stream finishes', async () => {
		const model = new FakeModel();
		const successes: unknown[] = [];
		const wrapped = wrapLanguageModel(model, {
			profile: 'safe',
			observer: {
				onSuccess(traceId, response) {
					successes.push({ traceId, response });
				},
			},
		});

		const stream = await wrapped.stream?.([{ role: 'human', content: 'Olá' }]);
		expect(successes).toHaveLength(0);
		let chunks = 0;
		for await (const chunk of stream as AsyncIterable<unknown>) {
			if (chunk) chunks++;
		}
		expect(chunks).toBe(1);
		expect(successes).toHaveLength(1);
		expect(successes[0]).toMatchObject({ response: { content: 'ok' } });
	});
});
