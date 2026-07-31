import { describe, expect, it } from 'vitest';
import { detectContentType } from '../../src/content/content-detector';
import { optimizeContent } from '../../src/content/optimize-content';
import { checkContentQuality } from '../../src/quality/quality-guard';

describe('content detection', () => {
	it('detects JSON, HTML, logs, and text', () => {
		expect(detectContentType('[{"id":1}]')).toBe('json');
		expect(detectContentType('<html><body>Olá</body></html>')).toBe('html');
		expect(detectContentType('INFO started\nERROR failed')).toBe('logs');
		expect(detectContentType('Uma conversa normal.')).toBe('text');
	});
});

describe('content optimization', () => {
	it('converts repeated JSON object schemas into a compact table', () => {
		const records = Array.from({ length: 50 }, (_, index) => ({
			id: `ORD-${1000 + index}`,
			status: 'active',
			department: 'Support',
			date: '21/07/2026',
		}));
		const original = JSON.stringify(records, null, 2);

		const result = optimizeContent(original, { contentType: 'json' });

		expect(result.manifest.format).toBe('json-table');
		expect(result.manifest.recordCount).toBe(50);
		expect(result.optimizedContent).toContain('ORD-1000');
		expect(result.optimizedContent).toContain('21/07/2026');
		expect(result.tokens.savingsPercent).toBeGreaterThan(30);
		expect(result.quality.passed).toBe(true);
	});

	it('compresses a nested API tool response into a retrievable table', () => {
		const original = JSON.stringify({
			data: Array.from({ length: 40 }, (_, index) => ({
				id: `LEAD-${index}`,
				status: 'open',
				city: index === 31 ? 'Campinas' : 'São Paulo',
			})),
			meta: { page: 1, total: 40 },
		});
		const result = optimizeContent(original, { contentType: 'tool_output' });
		expect(result.optimizedContent).toContain('@json-table');
		expect(result.optimizedContent).toContain('path:"data"');
		expect(result.optimizedContent).toContain('metadata:{"meta":{"page":1,"total":40}}');
		expect(result.strategies).toContain('tool-output-json');
		expect(result.quality.passed).toBe(true);
	});

	it('collapses repeated log lines and preserves fatal errors', () => {
		const original = [
			'INFO request completed',
			'INFO request completed',
			'INFO request completed',
			'FATAL database authentication failed',
		].join('\n');

		const result = optimizeContent(original, { contentType: 'logs' });

		expect(result.optimizedContent).toContain('INFO request completed ×3');
		expect(result.optimizedContent).toContain('FATAL database authentication failed');
		expect(result.quality.passed).toBe(true);
	});

	it('removes HTML scripts while preserving visible links', () => {
		const original =
			'<html><body><script>alert(1)</script><main><h1>Manual</h1><a href="https://example.com/a">Abrir</a></main></body></html>';

		const result = optimizeContent(original, { contentType: 'html' });

		expect(result.optimizedContent).not.toContain('alert(1)');
		expect(result.optimizedContent).toContain('Manual');
		expect(result.optimizedContent).toContain('Abrir (https://example.com/a)');
	});

	it('preserves explicitly protected blocks byte for byte', () => {
		const block =
			'<context-optimizer-protected>Cliente NÃO autorizou. Valor R$ 12.850,00.</context-optimizer-protected>';
		const original = `${block}\n\n---\n\nTexto repetido.\n\nTexto repetido.`;

		const result = optimizeContent(original, { contentType: 'text' });

		expect(result.optimizedContent).toContain(block);
		expect(result.quality.passed).toBe(true);
	});

	it('fails quality when a protected value disappears', () => {
		const quality = checkContentQuality('Pedido ORD-8172 em 21/07/2026', 'Pedido sem referência', {
			contentType: 'text',
			originalHash: 'hash',
			originalBytes: 10,
			optimizedBytes: 5,
			format: 'text',
		});

		expect(quality.passed).toBe(false);
		expect(quality.fallbackUsed).toBe(true);
	});

	it('strict quality rejects a changed negation even when exact values remain', () => {
		const manifest = {
			contentType: 'text' as const,
			originalHash: 'hash',
			originalBytes: 40,
			optimizedBytes: 35,
			format: 'text' as const,
		};
		const strict = checkContentQuality(
			'Pedido ORD-8172 não foi autorizado.',
			'Pedido ORD-8172 foi autorizado.',
			manifest,
			undefined,
			'strict',
		);
		const fast = checkContentQuality(
			'Pedido ORD-8172 não foi autorizado.',
			'Pedido ORD-8172 foi autorizado.',
			manifest,
			undefined,
			'fast',
		);
		expect(strict.passed).toBe(false);
		expect(strict.warnings).toContain('fact-polarity');
		expect(fast.passed).toBe(true);
	});

	it('critical quality preserves quoted values exactly', () => {
		const quality = checkContentQuality(
			'Use o status "aguardando expansão".',
			'Use o status aguardando expansão.',
			{
				contentType: 'text',
				originalHash: 'hash',
				originalBytes: 40,
				optimizedBytes: 36,
				format: 'text',
			},
			undefined,
			'critical',
		);
		expect(quality.passed).toBe(false);
		expect(quality.warnings).toContain('quoted-values');
	});

	it('never rewrites code or removes YAML document separators', () => {
		const original = [
			'apiVersion: v1',
			'kind: ConfigMap',
			'---',
			'apiVersion: v1',
			'kind: Secret',
		].join('\n');

		const result = optimizeContent(original, { contentType: 'code' });

		expect(result.optimizedContent).toBe(original);
		expect(result.strategies).toEqual(['preserve-code']);
		expect(result.tokens.saved).toBe(0);
	});

	it('applies include fields only at the root and preserves nested objects', () => {
		const original = JSON.stringify({
			id: 1,
			customer: { name: 'Ana', city: 'Campinas' },
			internal: 'remove',
		});

		const result = optimizeContent(original, {
			contentType: 'json',
			includeFields: ['id', 'customer'],
		});

		expect(JSON.parse(result.optimizedContent)).toEqual({
			id: 1,
			customer: { name: 'Ana', city: 'Campinas' },
		});
	});

	it('returns the original when a transformation would increase tokens', () => {
		const original = JSON.stringify([{ a: 1 }, { a: 2 }]);

		const result = optimizeContent(original, { contentType: 'json' });

		expect(result.optimizedContent).toBe(original);
		expect(result.strategies).toEqual(['fallback-original']);
		expect(result.tokens.optimized).toBe(result.tokens.original);
		expect(result.quality.fallbackReason).toBe('no_positive_savings');
	});

	it('validates every row in the reversible JSON table', () => {
		const original = JSON.stringify(
			Array.from({ length: 20 }, (_, index) => ({
				id: `LEAD-${index}`,
				active: index !== 7,
				percentage: `${index}%`,
			})),
		);

		const result = optimizeContent(original, { contentType: 'json' });

		expect(result.quality.passed).toBe(true);
		expect(result.quality.checks).toContainEqual({
			name: 'reversible-json-table',
			passed: true,
		});
	});

	it('does not claim optimization when unchanged text saves zero tokens', () => {
		const original = 'Conteúdo único sem formatação ou repetição.';

		const result = optimizeContent(original, { contentType: 'text' });

		expect(result.optimizedContent).toBe(original);
		expect(result.strategies).toEqual(['fallback-original']);
		expect(result.quality.fallbackReason).toBe('no_positive_savings');
	});
});
