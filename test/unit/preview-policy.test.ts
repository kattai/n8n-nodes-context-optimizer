import { describe, expect, it } from 'vitest';
import { resolvePreviewPolicy } from '../../src/policy/preview-policy';

describe('preview policy', () => {
	it('keeps Quality inline and differentiates Balanced from Savings', () => {
		const quality = resolvePreviewPolicy('quality', 10_000);
		const balanced = resolvePreviewPolicy('balanced', 10_000);
		const savings = resolvePreviewPolicy('savings', 10_000);

		expect(quality.thresholdTokens).toBe(Number.POSITIVE_INFINITY);
		expect(balanced.maxPreviewTokens).toBe(5_500);
		expect(savings.maxPreviewTokens).toBe(2_000);
		expect(balanced.maxItems).toBeGreaterThan(savings.maxItems);
	});

	it('maps legacy aliases to the matching v2 behavior', () => {
		expect(resolvePreviewPolicy('safe', 4_000)).toEqual(resolvePreviewPolicy('quality', 4_000));
		expect(resolvePreviewPolicy('aggressive', 4_000)).toEqual(
			resolvePreviewPolicy('savings', 4_000),
		);
	});
});
