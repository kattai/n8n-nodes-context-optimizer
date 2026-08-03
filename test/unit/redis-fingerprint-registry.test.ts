import { describe, expect, it } from 'vitest';
import { RedisFingerprintRegistry } from '../../src/cache/redis-fingerprint-registry';
import { FakeRedisClient } from '../helpers/fake-redis';

describe('Redis cache fingerprint registry', () => {
	it('counts concurrent observations and records measured provider cache use', async () => {
		const redis = new FakeRedisClient();
		const registry = new RedisFingerprintRegistry(
			{ url: 'redis://synthetic', keyPrefix: 'test-cache' },
			{ ttlHours: 24 },
			redis,
		);
		const input = {
			scope: 'synthetic-agent',
			position: 'system:0',
			content: 'Stable fictional policy used by every synthetic request.',
			estimatedTokens: 20,
		};
		const records = await Promise.all(Array.from({ length: 30 }, () => registry.observe(input)));
		const fingerprint = records[0]?.fingerprint ?? '';
		expect((await registry.get(fingerprint))?.seenCount).toBe(30);
		await registry.recordProviderCache([fingerprint], 18);
		expect((await registry.get(fingerprint))?.lastProviderCachedTokens).toBe(18);
	});
});
