import { describe, expect, it } from 'vitest';
import { RedisResourceStore } from '../../src/storage/redis-store';
import { FakeRedisClient } from '../helpers/fake-redis';

describe('Redis Context Storage', () => {
	it('isolates exact resources across 100 parallel synthetic sessions', async () => {
		const redis = new FakeRedisClient();
		const store = new RedisResourceStore(
			{ url: 'redis://synthetic', keyPrefix: 'parallel-resource' },
			1024 * 1024,
			undefined,
			redis,
		);
		const manifests = await Promise.all(
			Array.from({ length: 100 }, (_, index) =>
				store.store({
					content: JSON.stringify({ exactId: `SYN-${index}`, session: index }),
					contentType: 'json',
					ttlSeconds: 3600,
					scope: `workflow:session-${index}:owner-${index}`,
				}),
			),
		);
		await Promise.all(
			manifests.map(async (manifest, index) => {
				const scope = `workflow:session-${index}:owner-${index}`;
				expect((await store.read(manifest.resourceId, scope)).content).toContain(`SYN-${index}`);
				await expect(store.read(manifest.resourceId, 'workflow:wrong-session')).rejects.toThrow(
					'scope',
				);
			}),
		);
	});

	it('stores encrypted exact content, reuses its hash, and enforces scope', async () => {
		const redis = new FakeRedisClient();
		const store = new RedisResourceStore(
			{ url: 'redis://synthetic', keyPrefix: 'test-resource' },
			1024 * 1024,
			'synthetic-encryption-key',
			redis,
		);
		const input = {
			content: JSON.stringify([{ id: 'SYN-42', value: 12850 }]),
			contentType: 'json' as const,
			ttlSeconds: 3600,
			scope: 'workflow:session:user',
		};
		const first = await store.store(input);
		const second = await store.store(input);

		expect(second.resourceId).toBe(first.resourceId);
		expect(second.reuseCount).toBe(1);
		expect((await store.read(first.resourceId, input.scope)).content).toBe(input.content);
		await expect(store.read(first.resourceId, 'other-scope')).rejects.toThrow('scope');
		const raw = redis.peekHash(`test-resource:resource:${first.resourceId}`, 'content');
		expect(Buffer.from(raw ?? '', 'base64').subarray(0, 4).toString('ascii')).toBe('CSE1');
		const tampered = Buffer.from(raw ?? '', 'base64');
		tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
		redis.setHashField(
			`test-resource:resource:${first.resourceId}`,
			'content',
			tampered.toString('base64'),
		);
		await expect(store.read(first.resourceId, input.scope)).rejects.toThrow(
			'Storage decryption failed',
		);
	});
});
