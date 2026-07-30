import { describe, expect, it } from 'vitest';
import {
	assertCacheFingerprint,
	createCacheFingerprint,
} from '../../src/cache/fingerprint';

describe('cache fingerprint', () => {
	it('is deterministic for the same scope, position, and content', () => {
		const input = {
			scope: 'workflow:agent:model',
			position: 'messages[2].content',
			content: 'stable context',
		};

		expect(createCacheFingerprint(input)).toBe(createCacheFingerprint(input));
		expect(createCacheFingerprint(input)).toMatch(/^cf_[a-f0-9]{64}$/);
	});

	it('changes when scope, position, or content changes', () => {
		const base = {
			scope: 'workflow:agent:model',
			position: 'messages[2].content',
			content: 'stable context',
		};
		const fingerprints = new Set([
			createCacheFingerprint(base),
			createCacheFingerprint({ ...base, scope: 'other' }),
			createCacheFingerprint({ ...base, position: 'messages[3].content' }),
			createCacheFingerprint({ ...base, content: 'changed context' }),
		]);

		expect(fingerprints.size).toBe(4);
	});

	it('rejects malformed fingerprints and path traversal', () => {
		expect(() => assertCacheFingerprint('../outside')).toThrow(
			'Invalid cache fingerprint',
		);
	});
});
