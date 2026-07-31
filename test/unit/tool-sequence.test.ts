import { describe, expect, it } from 'vitest';
import { analyzeToolSequence } from '../../src/model-wrapper/message-sequence';

describe('tool sequence analysis', () => {
	it('groups parallel calls and results without losing IDs or order', () => {
		const result = analyzeToolSequence([
			{ role: 'user', content: 'Compare.' },
			{
				role: 'assistant',
				tool_calls: [
					{ id: 'call-a', name: 'search_a' },
					{ id: 'call-b', name: 'search_b' },
				],
			},
			{ role: 'tool', tool_call_id: 'call-b', content: 'B' },
			{ role: 'tool', tool_call_id: 'call-a', content: 'A' },
		]);

		expect(result.valid).toBe(true);
		expect(result.groups[0]).toMatchObject({
			status: 'recent_completed',
			callIds: ['call-a', 'call-b'],
			unresolvedCallIds: [],
			messageIndexes: [1, 2, 3],
			anchorMessageIndex: 0,
		});
		expect(result.completedResultIndexes).toEqual([2, 3]);
	});

	it('keeps an unfinished sequence active instead of treating it as invalid', () => {
		const result = analyzeToolSequence([
			{ role: 'user', content: 'Search.' },
			{ role: 'assistant', toolCalls: [{ id: 'active-1', name: 'search' }] },
		]);

		expect(result.valid).toBe(true);
		expect(result.groups[0]).toMatchObject({
			status: 'active',
			unresolvedCallIds: ['active-1'],
		});
		expect(result.activeMessageIndexes).toEqual([1]);
		expect(result.completedResultIndexes).toEqual([]);
	});

	it('supports Anthropic content blocks and provider aliases', () => {
		const result = analyzeToolSequence([
			{ type: 'human', content: 'Search.' },
			{
				type: 'ai',
				content: [{ type: 'tool_use', id: 'toolu-1', name: 'search', input: {} }],
			},
			{
				type: 'tool',
				content: [{ type: 'tool_result', tool_use_id: 'toolu-1', content: 'done' }],
			},
		]);

		expect(result.valid).toBe(true);
		expect(result.groups[0].callIds).toEqual(['toolu-1']);
		expect(result.completedResultIndexes).toEqual([2]);
	});

	it('rejects a mismatched result instead of pairing it by position', () => {
		const result = analyzeToolSequence([
			{ role: 'user', content: 'Search.' },
			{ role: 'assistant', tool_calls: [{ id: 'expected', name: 'search' }] },
			{ role: 'tool', tool_call_id: 'different', content: 'wrong' },
		]);

		expect(result).toMatchObject({ valid: false, issue: 'tool_result_id_mismatch' });
	});

	it('classifies older completed groups as archived', () => {
		const messages = [
			{ role: 'user', content: 'Search.' },
			{ role: 'assistant', tool_calls: [{ id: 'old', name: 'search' }] },
			{ role: 'tool', tool_call_id: 'old', content: 'done' },
			...Array.from({ length: 10 }, (_, index) => ({
				role: index % 2 ? 'assistant' : 'user',
				content: `message-${index}`,
			})),
		];
		const result = analyzeToolSequence(messages, 4);

		expect(result.groups[0].status).toBe('archived_completed');
	});
});
