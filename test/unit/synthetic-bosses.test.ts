import { describe, expect, it } from 'vitest';
import { runSyntheticBossBenchmark } from '../../src/benchmarks/synthetic-bosses';

describe('synthetic boss scenarios', () => {
	it('passes long-context, tool-heavy, and multi-agent quality gates', async () => {
		const result = await runSyntheticBossBenchmark();
		expect(result.passed).toBe(true);
		expect(result.longContext.reductionPercent).toBeGreaterThanOrEqual(30);
		expect(result.toolHeavy.clearIntentReductionPercent).toBeGreaterThanOrEqual(60);
		expect(result.toolHeavy.ambiguousKeptAll).toBe(true);
	});
});
