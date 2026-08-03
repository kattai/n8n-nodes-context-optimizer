import { randomUUID } from 'node:crypto';
import { assertCacheFingerprint, createCacheFingerprint } from './fingerprint';
import type {
	FingerprintRecord,
	FingerprintRegistry,
	FingerprintRegistryOptions,
	ObserveFingerprintInput,
} from './types';
import {
	getPooledRedisClient,
	type RedisClientLike,
	type RedisStoreConnection,
} from '../storage/redis-store';

const RELEASE_LOCK_SCRIPT =
	'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

export class RedisFingerprintRegistry implements FingerprintRegistry {
	private readonly prefix: string;
	private readonly ttlSeconds: number;

	constructor(
		private readonly connection: RedisStoreConnection,
		options: FingerprintRegistryOptions = {},
		private readonly injectedClient?: RedisClientLike,
	) {
		const ttlHours = options.ttlHours ?? 24;
		if (!Number.isFinite(ttlHours) || ttlHours < 1 || ttlHours > 720) {
			throw new Error('ttlHours must be between 1 and 720');
		}
		this.ttlSeconds = Math.ceil(ttlHours * 3600);
		this.prefix = connection.keyPrefix?.trim() || 'context-saver';
	}

	private key(fingerprint: string): string {
		assertCacheFingerprint(fingerprint);
		return `${this.prefix}:fingerprint:${fingerprint}`;
	}

	private async client(): Promise<RedisClientLike> {
		return this.injectedClient ?? (await getPooledRedisClient(this.connection));
	}

	private async withLock<T>(fingerprint: string, run: () => Promise<T>): Promise<T> {
		const client = await this.client();
		const key = `${this.key(fingerprint)}:lock`;
		const owner = randomUUID();
		const deadline = Date.now() + 10_000;
		while ((await client.set(key, owner, { NX: true, PX: 30_000 })) !== 'OK') {
			if (Date.now() >= deadline) throw new Error('Timed out acquiring fingerprint lock');
			await new Promise((resolve) => setTimeout(resolve, 15));
		}
		try {
			return await run();
		} finally {
			await client.eval(RELEASE_LOCK_SCRIPT, { keys: [key], arguments: [owner] });
		}
	}

	private async read(fingerprint: string): Promise<FingerprintRecord | undefined> {
		const value = await (await this.client()).hGet(this.key(fingerprint), 'record');
		return value ? (JSON.parse(value) as FingerprintRecord) : undefined;
	}

	private async write(record: FingerprintRecord): Promise<void> {
		const client = await this.client();
		await client.hSet(this.key(record.fingerprint), { record: JSON.stringify(record) });
		await client.expire(this.key(record.fingerprint), this.ttlSeconds);
	}

	async observe(input: ObserveFingerprintInput, now = new Date()): Promise<FingerprintRecord> {
		if (!Number.isFinite(input.estimatedTokens) || input.estimatedTokens < 0) {
			throw new Error('estimatedTokens must be zero or greater');
		}
		const fingerprint = createCacheFingerprint(input);
		return await this.withLock(fingerprint, async () => {
			const existing = await this.read(fingerprint);
			const active =
				existing && Date.parse(existing.expiresAt) > now.getTime() ? existing : undefined;
			const nowIso = now.toISOString();
			const record: FingerprintRecord = {
				storageVersion: 1,
				fingerprint,
				scope: input.scope,
				estimatedTokens: input.estimatedTokens,
				seenCount: (active?.seenCount ?? 0) + 1,
				firstSeenAt: active?.firstSeenAt ?? nowIso,
				lastSeenAt: nowIso,
				expiresAt: new Date(now.getTime() + this.ttlSeconds * 1000).toISOString(),
				...(input.providerCachedTokens !== undefined
					? { lastProviderCachedTokens: input.providerCachedTokens }
					: active?.lastProviderCachedTokens !== undefined
						? { lastProviderCachedTokens: active.lastProviderCachedTokens }
						: {}),
			};
			await this.write(record);
			return record;
		});
	}

	async get(fingerprint: string, now = new Date()): Promise<FingerprintRecord | undefined> {
		const record = await this.read(fingerprint);
		if (!record || Date.parse(record.expiresAt) <= now.getTime()) return undefined;
		return record;
	}

	async recordProviderCache(
		fingerprints: string[],
		cachedTokens: number,
		now = new Date(),
	): Promise<void> {
		if (!Number.isFinite(cachedTokens) || cachedTokens < 0) {
			throw new Error('cachedTokens must be zero or greater');
		}
		for (const fingerprint of [...new Set(fingerprints)]) {
			await this.withLock(fingerprint, async () => {
				const record = await this.get(fingerprint, now);
				if (record) await this.write({ ...record, lastProviderCachedTokens: cachedTokens });
			});
		}
	}

	async purgeExpired(): Promise<number> {
		return 0;
	}
}
