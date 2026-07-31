import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileSystemMemoryManager } from '../../src/memory/memory-manager';

const roots: string[] = [];

async function manager() {
	const root = await mkdtemp(join(tmpdir(), 'context-saver-memory-'));
	roots.push(root);
	return new FileSystemMemoryManager(root);
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('FileSystemMemoryManager', () => {
	it('puts only the current fact value in the model context and retains prior versions', async () => {
		const memory = await manager();
		await memory.updateSession({
			sessionKey: 'chat-1',
			scope: 'workflow-a',
			pinnedFacts: { city: 'Campinas', budget: 500_000 },
		});
		await memory.updateSession({
			sessionKey: 'chat-1',
			scope: 'workflow-a',
			pinnedFacts: { city: 'Sorocaba' },
		});

		const built = await memory.buildContext({ sessionKey: 'chat-1', scope: 'workflow-a' });
		const inspected = await memory.inspectSession('chat-1', 'workflow-a');

		expect(built.context.match(/Sorocaba/g)).toHaveLength(1);
		expect(built.context).not.toContain('Campinas');
		expect(inspected.pinnedFacts.city?.version).toBe(2);
		expect(inspected.pinnedFacts.city?.history).toMatchObject([
			{ version: 1, value: 'Campinas', status: 'superseded' },
		]);
	});

	it('keeps corrections and pending work protected after the recent window rolls', async () => {
		const memory = await manager();
		await memory.updateSession({
			sessionKey: 'chat-2',
			scope: 'workflow-a',
			recentWindow: 2,
			messages: [
				{ role: 'user', content: 'Correção: o pedido certo é ORD-991.', kind: 'correction' },
				{ role: 'assistant', content: 'Vou verificar.' },
				{ role: 'user', content: 'Pendente: confirmar o pagamento.', kind: 'pending' },
				{ role: 'assistant', content: 'Entendido.' },
			],
		});

		const built = await memory.buildContext({ sessionKey: 'chat-2', scope: 'workflow-a' });
		const inspected = await memory.inspectSession('chat-2', 'workflow-a');

		expect(built.context).toContain('ORD-991');
		expect(built.context).toContain('confirmar o pagamento');
		expect(built.context.match(/ORD-991/g)).toHaveLength(1);
		expect(inspected.archivedEvents.length).toBe(2);
		expect(inspected.protectedItems.map((item) => item.kind)).toEqual(['correction', 'pending']);
	});

	it('does not replace a valid summary with an empty or stale candidate', async () => {
		const memory = await manager();
		const first = await memory.updateSession({
			sessionKey: 'chat-3',
			scope: 'workflow-a',
			summaryCandidate: 'Cliente confirmou produto e prazo de entrega.',
		});
		const second = await memory.updateSession({
			sessionKey: 'chat-3',
			scope: 'workflow-a',
			summaryCandidate: '   ',
		});
		const third = await memory.updateSession({
			sessionKey: 'chat-3',
			scope: 'workflow-a',
			summaryCandidate: 'Resumo produzido sobre uma revisão antiga.',
			summaryBasedOnRevision: first.session.revision - 1,
		});

		expect(second.warnings).toContain('summary_rejected_empty');
		expect(third.warnings).toContain('summary_rejected_stale');
		expect(third.session.incrementalSummary?.text).toBe(
			'Cliente confirmou produto e prazo de entrega.',
		);
	});

	it('rejects summaries that omit required exact values or exceed the token budget', async () => {
		const memory = await manager();
		const valid = await memory.updateSession({
			sessionKey: 'chat-summary-guard',
			scope: 'workflow-a',
			summaryCandidate: 'Pedido ORD-991 continua pendente.',
			summaryRequiredValues: ['ORD-991'],
		});
		const missing = await memory.updateSession({
			sessionKey: 'chat-summary-guard',
			scope: 'workflow-a',
			summaryCandidate: 'Pedido continua pendente.',
			summaryRequiredValues: ['ORD-991'],
		});
		const oversized = await memory.updateSession({
			sessionKey: 'chat-summary-guard',
			scope: 'workflow-a',
			summaryCandidate: 'contexto '.repeat(600),
			summaryMaximumTokens: 100,
		});

		expect(missing.warnings).toContain('summary_rejected_missing_required_value');
		expect(oversized.warnings).toContain('summary_rejected_oversize');
		expect(oversized.session.incrementalSummary?.text).toBe(valid.session.incrementalSummary?.text);
	});

	it('isolates equal session keys by scope', async () => {
		const memory = await manager();
		await memory.updateSession({
			sessionKey: 'same-key',
			scope: 'workflow-a',
			pinnedFacts: { tenant: 'A' },
		});
		await memory.updateSession({
			sessionKey: 'same-key',
			scope: 'workflow-b',
			pinnedFacts: { tenant: 'B' },
		});

		const a = await memory.buildContext({ sessionKey: 'same-key', scope: 'workflow-a' });
		const b = await memory.buildContext({ sessionKey: 'same-key', scope: 'workflow-b' });

		expect(a.context).toContain('"tenant":"A"');
		expect(a.context).not.toContain('"tenant":"B"');
		expect(b.context).toContain('"tenant":"B"');
	});

	it('deletes one session and purges only expired session files', async () => {
		const memory = await manager();
		await memory.updateSession({ sessionKey: 'delete-me', scope: 'workflow-a' });
		await memory.updateSession({ sessionKey: 'expire-me', scope: 'workflow-a', ttlSeconds: 3600 });
		await memory.updateSession({ sessionKey: 'keep-me', scope: 'workflow-a', ttlSeconds: 86400 });

		expect(await memory.deleteSession('delete-me', 'workflow-a')).toBe(true);
		expect(await memory.deleteSession('delete-me', 'workflow-a')).toBe(false);
		expect(await memory.purgeExpired(new Date(Date.now() + 7200 * 1000))).toBe(1);
		expect((await memory.inspectSession('keep-me', 'workflow-a')).sessionKey).toBe('keep-me');
	});
});
