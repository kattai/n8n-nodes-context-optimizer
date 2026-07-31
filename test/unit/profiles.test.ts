import { describe, expect, it } from 'vitest';
import { resolveProfile } from '../../src/core/profiles';

describe('resolveProfile', () => {
	it('uses balanced defaults', () => {
		const profile = resolveProfile('balanced');

		expect(profile.name).toBe('balanced');
		expect(profile.keepRecentMessages).toBe(6);
		expect(profile.allowUniqueContentTrimming).toBe(false);
	});

	it('allows safe custom overrides', () => {
		const profile = resolveProfile('custom', {
			keepRecentMessages: 8,
			maxInputTokens: 5000,
			allowUniqueContentTrimming: true,
		});

		expect(profile.keepRecentMessages).toBe(8);
		expect(profile.maxInputTokens).toBe(5000);
		expect(profile.allowUniqueContentTrimming).toBe(true);
	});

	it('maps legacy names without changing their reported name', () => {
		expect(resolveProfile('safe')).toMatchObject({
			name: 'safe',
			canonicalName: 'quality',
			eligibleSavingsMinPercent: 15,
			eligibleSavingsMaxPercent: 35,
		});
		expect(resolveProfile('aggressive')).toMatchObject({
			name: 'aggressive',
			canonicalName: 'savings',
			eligibleSavingsMinPercent: 60,
			eligibleSavingsMaxPercent: 85,
		});
	});

	it('keeps quality more conservative than balanced and savings', () => {
		const quality = resolveProfile('quality');
		const balanced = resolveProfile('balanced');
		const savings = resolveProfile('savings');
		expect(quality.keepRecentMessages).toBeGreaterThan(balanced.keepRecentMessages);
		expect(balanced.keepRecentMessages).toBeGreaterThan(savings.keepRecentMessages);
		expect(quality.virtualization).toBe('disabled');
		expect(balanced.virtualization).toBe('automatic');
		expect(savings.virtualization).toBe('required');
	});

	it('rejects invalid limits', () => {
		expect(() => resolveProfile('custom', { keepRecentMessages: -1 })).toThrow(
			'keepRecentMessages',
		);
	});
});
