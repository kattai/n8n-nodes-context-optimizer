import { describe, expect, it } from 'vitest';
import { extractProtectedFacts, validateProtectedFacts } from '../../src/core/protected-facts';

describe('protected facts', () => {
	it('extracts Brazilian operational values', () => {
		const facts = extractProtectedFacts(
			'Pedido ORC-9A7 de R$ 1.500,00 para 21/07/2026 às 09:00, quantidade 3 e contato teste@exemplo.com.',
		);

		expect(facts.map((fact) => fact.value)).toEqual(
			expect.arrayContaining(['ORC-9A7', 'R$ 1.500,00', '21/07/2026', '09:00', '3', 'teste@exemplo.com']),
		);
	});

	it('detects a missing protected value', () => {
		const before = extractProtectedFacts('Orçamento R$ 900,00 para 22/07/2026.');
		const result = validateProtectedFacts(before, 'Orçamento confirmado para 22/07/2026.');

		expect(result.valid).toBe(false);
		expect(result.missing).toContain('R$ 900,00');
	});
});
