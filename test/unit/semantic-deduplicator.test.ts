import { describe, expect, it } from 'vitest';
import { semanticDeduplicate } from '../../src/semantic/semantic-deduplicator';
import type { SemanticUnit } from '../../src/semantic/types';

const units: SemanticUnit[] = [
	{
		id: 'h:0',
		source: 'history',
		index: 0,
		text: 'Repeated account status '.repeat(40),
		protected: false,
	},
	{
		id: 'h:1',
		source: 'history',
		index: 1,
		text: 'Equivalent account status '.repeat(40),
		protected: false,
	},
	{
		id: 'h:2',
		source: 'history',
		index: 2,
		text: 'Correction: ID ORD-991 is current.',
		protected: true,
	},
];

describe('semanticDeduplicate', () => {
	it('accepts a confident, net-positive selection that preserves protected units', async () => {
		const result = await semanticDeduplicate(
			units,
			{
				deduplicate: async () => ({
					keepIds: ['h:0', 'h:2'],
					confidence: 0.96,
					compressorTokens: 5,
				}),
			},
			{ currentTask: 'account status', minimumConfidence: 0.85, maximumUnits: 10 },
		);
		expect(result.applied).toBe(true);
		expect(result.units.map((unit) => unit.id)).toEqual(['h:0', 'h:2']);
		expect(result.savedTokens).toBeGreaterThan(0);
	});

	it('falls back when a protected unit is omitted', async () => {
		const result = await semanticDeduplicate(
			units,
			{ deduplicate: async () => ({ keepIds: ['h:0'], confidence: 0.99 }) },
			{ currentTask: 'account status', minimumConfidence: 0.85, maximumUnits: 10 },
		);
		expect(result).toMatchObject({
			applied: false,
			fallbackReason: 'protected_unit_missing',
			units,
		});
	});

	it('falls back on low confidence or negative net savings', async () => {
		const low = await semanticDeduplicate(
			units,
			{ deduplicate: async () => ({ keepIds: ['h:0', 'h:2'], confidence: 0.4 }) },
			{ currentTask: 'account status', minimumConfidence: 0.85, maximumUnits: 10 },
		);
		const expensive = await semanticDeduplicate(
			units,
			{
				deduplicate: async () => ({
					keepIds: ['h:0', 'h:2'],
					confidence: 0.99,
					compressorTokens: 100_000,
				}),
			},
			{ currentTask: 'account status', minimumConfidence: 0.85, maximumUnits: 10 },
		);
		expect(low.fallbackReason).toBe('low_confidence');
		expect(expensive.fallbackReason).toBe('negative_net_savings');
	});
});
