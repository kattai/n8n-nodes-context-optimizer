import { describe, expect, it } from 'vitest';
import { bm25Scores } from '../../src/relevance/bm25';
import { allocateCategoryBudget } from '../../src/relevance/category-budget';
import { selectChunks } from '../../src/relevance/chunk-selector';
import { projectFields } from '../../src/relevance/field-projector';

describe('deterministic relevance', () => {
	it('ranks the task marker above unrelated chunks', () => {
		const scores = bm25Scores('redis timeout', [
			'routine database maintenance',
			'exact Redis timeout evidence ERR-42',
			'customer profile details',
		]);
		expect(scores[1]).toBeGreaterThan(scores[0]);
		expect(scores[1]).toBeGreaterThan(scores[2]);
	});

	it('keeps protected chunks and diversifies sources within budget', () => {
		const selected = selectChunks(
			[
				{ id: 'a1', index: 0, source: 'a', content: 'payment failure exact evidence' },
				{ id: 'a2', index: 1, source: 'a', content: 'payment failure repeated' },
				{ id: 'b1', index: 2, source: 'b', content: 'payment failure second source' },
				{ id: 'p', index: 3, source: 'c', content: 'mandatory correction', protected: true },
			],
			{ query: 'payment failure', maxTokens: 100, maxChunks: 3, diversityBonus: 2 },
		);
		expect(selected.map((chunk) => chunk.id)).toContain('p');
		expect(new Set(selected.map((chunk) => chunk.source)).size).toBeGreaterThan(1);
	});

	it('projects task-relevant fields without dropping protected paths', () => {
		const result = projectFields(
			{
				id: 'ORD-42',
				status: 'payment failed',
				secretDecision: 'DO NOT REFUND',
				marketingBiography: 'long unrelated text',
			},
			{
				query: 'payment status',
				protectedPaths: ['$.secretDecision'],
				alwaysIncludePaths: ['$.id'],
				maximumFields: 3,
			},
		);
		expect(result.projected).toEqual({
			id: 'ORD-42',
			status: 'payment failed',
			secretDecision: 'DO NOT REFUND',
		});
		expect(result.omittedPaths).toContain('$.marketingBiography');
		expect(result.recoverable).toBe(true);
	});

	it('reserves protected demand and redistributes unused budget', () => {
		const result = allocateCategoryBudget(1_000, [
			{
				category: 'system_instructions',
				demandTokens: 300,
				protected: true,
			},
			{ category: 'old_history', demandTokens: 2_000, weight: 1 },
			{ category: 'retrieved_context', demandTokens: 2_000, weight: 3 },
		]);
		expect(result.system_instructions).toBe(300);
		expect(result.retrieved_context).toBeGreaterThan(result.old_history);
		expect(Object.values(result).reduce((sum, value) => sum + value, 0)).toBe(1_000);
	});
});
