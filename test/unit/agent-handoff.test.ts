import { describe, expect, it } from 'vitest';
import { buildAgentHandoff } from '../../src/handoff/agent-handoff';

describe('Agent Handoff', () => {
	it('deduplicates structured evidence and preserves the exact objective', () => {
		const result = buildAgentHandoff({
			fromAgent: 'Research',
			toAgent: 'Writer',
			objective: 'Use order ORD-8172 and amount R$ 12.850,00 exactly.',
			confirmedFacts: ['Order ORD-8172', 'Order ORD-8172'],
			decisions: ['Do not invent missing values'],
			pendingActions: ['Draft answer'],
			resourceIds: ['ctx_123', 'ctx_123'],
			sourceOutput: { rows: [{ id: 'ORD-8172', status: 'open' }] },
		});
		const context = JSON.parse(result.handoffContext) as Record<string, unknown>;
		expect(context.objective).toBe('Use order ORD-8172 and amount R$ 12.850,00 exactly.');
		expect(context.confirmedFacts).toEqual(['Order ORD-8172']);
		expect(context.resourceIds).toEqual(['ctx_123']);
		expect(result.receipt.qualityPassed).toBe(true);
	});

	it('rejects a handoff without an objective', () => {
		expect(() => buildAgentHandoff({ objective: ' ' })).toThrow('objective is required');
	});
});
