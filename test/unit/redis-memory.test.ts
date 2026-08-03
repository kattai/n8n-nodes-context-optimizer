import { describe, expect, it } from 'vitest';
import { FileSystemMemoryManager } from '../../src/memory/memory-manager';
import { RedisMemoryPersistence } from '../../src/memory/persistence';
import { FakeRedisClient } from '../helpers/fake-redis';

describe('Redis-backed Session Memory', () => {
	it('isolates 100 simultaneous synthetic conversations', async () => {
		const redis = new FakeRedisClient();
		const persistence = new RedisMemoryPersistence(
			{ url: 'redis://synthetic', keyPrefix: 'test' },
			redis,
		);
		const memory = new FileSystemMemoryManager(
			'ignored-with-redis',
			2 * 1024 * 1024,
			persistence,
			'synthetic-encryption-key',
		);

		await Promise.all(
			Array.from({ length: 100 }, (_, index) =>
				memory.updateSession({
					sessionKey: `session-${index}`,
					scope: 'synthetic-workflow',
					pinnedFacts: { tenant: `tenant-${index}`, exactId: `SYN-${index}` },
					messages: [{ role: 'user', content: `Synthetic message ${index}` }],
				}),
			),
		);

		const contexts = await Promise.all(
			Array.from({ length: 100 }, (_, index) =>
				memory.buildContext({ sessionKey: `session-${index}`, scope: 'synthetic-workflow' }),
			),
		);
		for (let index = 0; index < contexts.length; index++) {
			expect(contexts[index]?.context).toContain(`SYN-${index}`);
			expect(contexts[index]?.context).not.toContain(`SYN-${(index + 1) % 100}`);
		}
	});

	it('serializes concurrent updates to the same session without losing messages', async () => {
		const redis = new FakeRedisClient();
		const persistence = new RedisMemoryPersistence(
			{ url: 'redis://synthetic', keyPrefix: 'test-lock' },
			redis,
		);
		const memory = new FileSystemMemoryManager('ignored', 2 * 1024 * 1024, persistence);

		await Promise.all(
			Array.from({ length: 40 }, (_, index) =>
				memory.updateSession({
					sessionKey: 'shared-session',
					scope: 'synthetic-workflow',
					recentWindow: 100,
					messages: [
						{ id: `message-${index}`, role: 'user', content: `Synthetic ${index}` },
					],
				}),
			),
		);

		expect(
			(await memory.inspectSession('shared-session', 'synthetic-workflow')).recentMessages,
		).toHaveLength(40);
	});
});
