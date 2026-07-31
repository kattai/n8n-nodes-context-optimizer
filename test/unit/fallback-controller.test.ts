import { describe, expect, it } from 'vitest';
import { selectQualityFallback } from '../../src/quality/fallback-controller';

function candidate(name: string, content: string) {
	return {
		name,
		value: content,
		content,
		manifest: {
			contentType: 'text' as const,
			originalHash: '',
			originalBytes: Buffer.byteLength(content),
			optimizedBytes: Buffer.byteLength(content),
			format: 'text' as const,
		},
	};
}

describe('selectQualityFallback', () => {
	it('falls from an unsafe semantic candidate to a safe deterministic candidate', () => {
		const originalText = `${'Pedido ORD-8172 não foi autorizado.\n'.repeat(40)}Fim.`;
		const result = selectQualityFallback({
			original: candidate('original', originalText),
			candidates: [
				candidate('semantic', 'Pedido ORD-8172 foi autorizado.\nFim.'),
				candidate('deterministic', 'Pedido ORD-8172 não foi autorizado.\nFim.'),
			],
			level: 'strict',
		});
		expect(result.selected.name).toBe('deterministic');
		expect(result.fallbackUsed).toBe(true);
		expect(result.attempted).toEqual(['semantic', 'deterministic']);
	});

	it('returns original when paid verification makes every optimization negative', () => {
		const original = candidate('original', 'small original text');
		const result = selectQualityFallback({
			original,
			candidates: [candidate('semantic', 'small text')],
			verificationTokens: 100,
		});
		expect(result.selected.name).toBe('original');
		expect(result.fallbackUsed).toBe(true);
	});
});
