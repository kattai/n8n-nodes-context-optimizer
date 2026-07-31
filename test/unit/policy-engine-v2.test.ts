import { describe, expect, it } from 'vitest';
import { canonicalizeContext } from '../../src/context/canonical-context';
import { decideContextPolicy } from '../../src/policy/policy-engine';

function context() {
	return canonicalizeContext({
		systemPrompt: 'Never invent IDs.',
		currentMessage: 'Find ORD-42.',
		conversationHistory: Array.from({ length: 12 }, (_, index) => ({
			role: index % 2 ? 'assistant' : 'user',
			content: `Historical message ${index} ${'detail '.repeat(100)}`,
		})),
		retrievedContext: `ORD-42 ${'large exact payload '.repeat(500)}`,
	});
}

describe('Context Saver policy engine', () => {
	it('never removes protected blocks in any profile', () => {
		for (const profile of ['quality', 'balanced', 'savings'] as const) {
			const result = decideContextPolicy(context(), {
				profile,
				retrievalAvailable: true,
			});
			const protectedDecisions = result.decisions.filter((decision) =>
				['system_instructions', 'current_message'].includes(decision.category),
			);
			expect(protectedDecisions.every((decision) => decision.action === 'preserve')).toBe(true);
		}
	});

	it('keeps Quality structural-only and never virtualizes', () => {
		const result = decideContextPolicy(context(), {
			profile: 'quality',
			retrievalAvailable: true,
		});
		expect(result.decisions.some((decision) => decision.action === 'virtualize')).toBe(false);
		expect(result.targetEligibleSavingsPercent).toEqual({ min: 15, max: 35 });
	});

	it('virtualizes only recoverable large blocks when retrieval exists', () => {
		const result = decideContextPolicy(context(), {
			profile: 'balanced',
			retrievalAvailable: true,
			virtualizationThresholdTokens: 100,
		});
		const virtualized = result.decisions.filter((decision) => decision.action === 'virtualize');
		expect(virtualized.length).toBeGreaterThan(0);
		expect(virtualized.every((decision) => decision.category !== 'current_message')).toBe(true);
	});

	it('recommends retrieval instead of silently dropping recoverable context', () => {
		const result = decideContextPolicy(context(), {
			profile: 'savings',
			retrievalAvailable: false,
		});
		expect(result.status).toBe('retrieval_recommended');
		expect(result.decisions.some((decision) => decision.action === 'virtualize')).toBe(false);
	});

	it('honors an explicit category budget', () => {
		const result = decideContextPolicy(context(), {
			categoryBudgets: { retrieved_context: 777 },
		});
		expect(
			result.decisions.find((decision) => decision.category === 'retrieved_context')?.budgetTokens,
		).toBe(777);
	});
});
