import { describe, expect, it } from 'vitest';
import { semanticRerank } from '../../src/semantic/semantic-reranker';
import type { SemanticUnit } from '../../src/semantic/types';

const units: SemanticUnit[] = Array.from({ length: 8 }, (_, index) => ({
	id: `r:${index}`,
	source: 'retrieved_context' as const,
	index,
	text: `Evidence ${index} `.repeat(30),
	protected: index === 7,
}));

describe('semanticRerank', () => {
	it('selects ranked evidence under budget and always keeps protected units', async () => {
		const result = await semanticRerank(
			units,
			{
				rerank: async () => ({
					rankedIds: ['r:2', 'r:4', 'r:1'],
					confidence: 0.95,
					compressorTokens: 3,
				}),
			},
			{
				currentTask: 'Evidence 2',
				minimumConfidence: 0.8,
				maximumUnits: 20,
				maximumSelectedUnits: 3,
				tokenBudget: 500,
			},
		);
		expect(result.applied).toBe(true);
		expect(result.units.map((unit) => unit.id)).toEqual(['r:2', 'r:4', 'r:7']);
	});

	it('rejects unknown IDs and low confidence', async () => {
		const invalid = await semanticRerank(
			units,
			{ rerank: async () => ({ rankedIds: ['missing'], confidence: 0.99 }) },
			{
				currentTask: 'x',
				minimumConfidence: 0.8,
				maximumUnits: 20,
				maximumSelectedUnits: 3,
				tokenBudget: 500,
			},
		);
		const low = await semanticRerank(
			units,
			{ rerank: async () => ({ rankedIds: ['r:2'], confidence: 0.2 }) },
			{
				currentTask: 'x',
				minimumConfidence: 0.8,
				maximumUnits: 20,
				maximumSelectedUnits: 3,
				tokenBudget: 500,
			},
		);
		expect(invalid.fallbackReason).toBe('invalid_adapter_response');
		expect(low.fallbackReason).toBe('low_confidence');
	});
});
