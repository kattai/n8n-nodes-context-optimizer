import { describe, expect, it } from 'vitest';
import { deduplicateUnits } from '../../src/core/deduplicate';

describe('deduplicateUnits', () => {
	it('never treats opposite instructions as approximate duplicates', () => {
		const allow = 'O agente pode confirmar o agendamento automaticamente.';
		const deny = 'O agente não pode confirmar o agendamento automaticamente.';

		expect(deduplicateUnits([allow, deny], true)).toEqual([allow, deny]);
	});
});
