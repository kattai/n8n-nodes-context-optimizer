import type { RedisClientLike, RedisStoreConnection } from '../storage/redis-store';
import { getPooledRedisClient } from '../storage/redis-store';
import { randomUUID } from 'node:crypto';

const RELEASE_LOCK_SCRIPT =
	'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

export interface MemoryPersistence {
	read(key: string): Promise<Buffer | undefined>;
	write(key: string, value: Buffer, ttlSeconds: number): Promise<void>;
	delete(key: string): Promise<boolean>;
	purgeExpired(): Promise<number>;
	withLock?<T>(key: string, run: () => Promise<T>): Promise<T>;
}

export class RedisMemoryPersistence implements MemoryPersistence {
	private readonly prefix: string;

	constructor(
		private readonly connection: RedisStoreConnection,
		private readonly injectedClient?: RedisClientLike,
	) {
		this.prefix = connection.keyPrefix?.trim() || 'context-saver';
	}

	private key(memoryId: string): string {
		if (!/^mem_[a-f0-9]{32}$/.test(memoryId)) throw new Error('Invalid memory ID');
		return `${this.prefix}:memory:${memoryId}`;
	}

	private lockKey(memoryId: string): string {
		if (!/^mem_[a-f0-9]{32}$/.test(memoryId)) throw new Error('Invalid memory ID');
		return `${this.prefix}:memory-lock:${memoryId}`;
	}

	private async client(): Promise<RedisClientLike> {
		return this.injectedClient ?? (await getPooledRedisClient(this.connection));
	}

	async read(memoryId: string): Promise<Buffer | undefined> {
		const value = await (await this.client()).hGet(this.key(memoryId), 'data');
		return value ? Buffer.from(value, 'base64') : undefined;
	}

	async write(memoryId: string, value: Buffer, ttlSeconds: number): Promise<void> {
		const client = await this.client();
		await client.hSet(this.key(memoryId), { data: value.toString('base64') });
		await client.expire(this.key(memoryId), Math.max(1, Math.ceil(ttlSeconds)));
	}

	async delete(memoryId: string): Promise<boolean> {
		return (await (await this.client()).del(this.key(memoryId))) > 0;
	}

	async purgeExpired(): Promise<number> {
		return 0;
	}

	async withLock<T>(memoryId: string, run: () => Promise<T>): Promise<T> {
		const client = await this.client();
		const key = this.lockKey(memoryId);
		const owner = randomUUID();
		const deadline = Date.now() + 10_000;
		while ((await client.set(key, owner, { NX: true, PX: 30_000 })) !== 'OK') {
			if (Date.now() >= deadline) throw new Error(`Timed out acquiring memory lock for ${memoryId}`);
			await new Promise((resolve) => setTimeout(resolve, 15 + Math.floor(Math.random() * 20)));
		}
		try {
			return await run();
		} finally {
			await client.eval(RELEASE_LOCK_SCRIPT, { keys: [key], arguments: [owner] });
		}
	}
}
