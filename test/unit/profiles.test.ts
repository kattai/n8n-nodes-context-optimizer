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

	it('rejects invalid limits', () => {
		expect(() => resolveProfile('custom', { keepRecentMessages: -1 })).toThrow(
			'keepRecentMessages',
		);
	});
});
