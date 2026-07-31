import { describe, expect, it } from 'vitest';
import { canonicalizeContext, stableSerialize } from '../../src/context/canonical-context';

describe('canonical context', () => {
	it('is deterministic regardless of object key order', () => {
		const left = canonicalizeContext({
			systemPrompt: { language: 'pt-BR', role: 'assistant' },
			currentMessage: 'Qual é o status?',
			retrievedContext: { id: 42, status: 'open' },
		});
		const right = canonicalizeContext({
			systemPrompt: { role: 'assistant', language: 'pt-BR' },
			currentMessage: 'Qual é o status?',
			retrievedContext: { status: 'open', id: 42 },
		});

		expect(left.hash).toBe(right.hash);
		expect(stableSerialize(left.blocks)).toBe(stableSerialize(right.blocks));
	});

	it('protects system instructions and the current message in separate categories', () => {
		const result = canonicalizeContext({
			systemPrompt: 'Never invent identifiers.',
			conversationHistory: [{ role: 'user', content: 'Earlier question' }],
			currentMessage: 'Return order ORD-42.',
		});

		const system = result.blocks.find((block) => block.category === 'system_instructions');
		const current = result.blocks.find((block) => block.category === 'current_message');
		expect(system).toMatchObject({ protected: true, exactness: 'byte_exact' });
		expect(current).toMatchObject({ protected: true, exactness: 'byte_exact' });
		expect(system?.id).not.toBe(current?.id);
	});

	it('keeps tool calls and results identifiable by their call id', () => {
		const result = canonicalizeContext({
			currentMessage: 'Continue',
			conversationHistory: [
				{ role: 'user', content: 'Find order' },
				{
					role: 'assistant',
					content: '',
					tool_calls: [{ id: 'call-42', name: 'find_order', args: { id: 42 } }],
				},
				{ role: 'tool', tool_call_id: 'call-42', content: '{"id":42,"status":"open"}' },
			],
		});

		expect(result.blocks.map((block) => block.category)).toContain('tool_call');
		expect(result.blocks.map((block) => block.category)).toContain('tool_result');
		expect(result.toolSequences).toHaveLength(1);
		expect(result.toolSequences[0]).toMatchObject({
			status: 'recent_completed',
			callIds: ['call-42'],
			messageIndexes: [1, 2],
		});
	});

	it('marks an unfinished tool sequence as active', () => {
		const result = canonicalizeContext({
			currentMessage: 'Continue',
			conversationHistory: [
				{ role: 'user', content: 'Find order' },
				{ role: 'assistant', tool_calls: [{ id: 'pending-1', name: 'find_order' }] },
			],
		});

		expect(result.toolSequences[0]).toMatchObject({
			status: 'active',
			callIds: ['pending-1'],
		});
	});
});
