import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import { createClient } from 'redis';
import { estimateTokens } from '../core/token-estimator';
import {
	decryptEnvelope,
	encryptEnvelope,
	isEncryptedEnvelope,
} from '../security/encrypted-envelope';
import { containsSecretLikeContent } from '../security/secret-detector';
import {
	ResourceExpiredError,
	ResourceIntegrityError,
	ResourceNotFoundError,
	ResourceScopeError,
} from './filesystem-store';
import { assertResourceId, createResourceId } from './resource-id';
import type { ResourceManifest, ResourceStore, StoredResource, StoreResourceInput } from './types';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const RELEASE_LOCK_SCRIPT =
	'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

export interface RedisStoreConnection {
	url: string;
	username?: string;
	password?: string;
	keyPrefix?: string;
}

export interface RedisClientLike {
	connect(): Promise<unknown>;
	isOpen: boolean;
	set(key: string, value: string, options?: { NX?: boolean; PX?: number }): Promise<string | null>;
	eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
	hGet(key: string, field: string): Promise<string | null>;
	hSet(key: string, values: Record<string, string>): Promise<unknown>;
	expire(key: string, seconds: number): Promise<unknown>;
	del(key: string): Promise<number>;
	scanIterator(options: { MATCH: string; COUNT: number }): AsyncIterable<string | string[]>;
	ttl(key: string): Promise<number>;
}

const clients = new Map<string, Promise<RedisClientLike>>();

export function getPooledRedisClient(connection: RedisStoreConnection): Promise<RedisClientLike> {
	const poolKey = createHash('sha256')
		.update(connection.url)
		.update('\0')
		.update(connection.username ?? '')
		.update('\0')
		.update(connection.password ?? '')
		.digest('hex');
	let client = clients.get(poolKey);
	if (!client) {
		const createdPromise = (async (): Promise<RedisClientLike> => {
			const created = createClient({
				url: connection.url,
				...(connection.username ? { username: connection.username } : {}),
				...(connection.password ? { password: connection.password } : {}),
			});
			created.on('error', () => undefined);
			await created.connect();
			return created as unknown as RedisClientLike;
		})();
		clients.set(poolKey, createdPromise);
		client = createdPromise;
	}
	return client;
}

export class RedisResourceStore implements ResourceStore {
	private readonly prefix: string;

	constructor(
		private readonly connection: RedisStoreConnection,
		private readonly maxResourceBytes = 10 * 1024 * 1024,
		private readonly encryptionKey?: string,
		private readonly injectedClient?: RedisClientLike,
	) {
		if (!connection.url.trim()) throw new Error('Redis URL is required');
		this.prefix = connection.keyPrefix?.trim() || 'context-saver';
	}

	private key(resourceId: string): string {
		assertResourceId(resourceId);
		return `${this.prefix}:resource:${resourceId}`;
	}

	private async client(): Promise<RedisClientLike> {
		const client = this.injectedClient ?? (await getPooledRedisClient(this.connection));
		if (!client.isOpen) await client.connect();
		return client;
	}

	private async withResourceLock<T>(resourceId: string, run: () => Promise<T>): Promise<T> {
		const client = await this.client();
		const key = `${this.key(resourceId)}:lock`;
		const owner = randomUUID();
		const deadline = Date.now() + 10_000;
		while ((await client.set(key, owner, { NX: true, PX: 30_000 })) !== 'OK') {
			if (Date.now() >= deadline)
				throw new Error(`Timed out acquiring resource lock for ${resourceId}`);
			await new Promise((resolve) => setTimeout(resolve, 15));
		}
		try {
			return await run();
		} finally {
			await client.eval(RELEASE_LOCK_SCRIPT, { keys: [key], arguments: [owner] });
		}
	}

	async store(input: StoreResourceInput): Promise<ResourceManifest> {
		const bytes = Buffer.byteLength(input.content);
		if (bytes > this.maxResourceBytes) {
			throw new Error(`Resource exceeds maximum size of ${this.maxResourceBytes} bytes`);
		}
		if (!Number.isFinite(input.ttlSeconds) || input.ttlSeconds <= 0) {
			throw new Error('ttlSeconds must be greater than zero');
		}
		const secretLike = containsSecretLikeContent(input.content);
		if (secretLike && !input.allowSecretLikeContent) {
			throw new Error('Secret-like content is blocked by default');
		}
		const now = new Date();
		const originalHash = createHash('sha256').update(input.content).digest('hex');
		const resourceId = createResourceId(
			input.content,
			input.scope,
			this.encryptionKey ? 'aes-256-gcm' : 'plain',
		);
		return await this.withResourceLock(resourceId, async () => {
			const client = await this.client();
			let existing: ResourceManifest | undefined;
			const existingText = await client.hGet(this.key(resourceId), 'manifest');
			if (existingText) existing = JSON.parse(existingText) as ResourceManifest;
			const reused = existing?.originalHash === originalHash && existing.scope === input.scope;
			const compressed = await gzipAsync(Buffer.from(input.content, 'utf8'));
			const payload = this.encryptionKey
				? encryptEnvelope(compressed, this.encryptionKey)
				: compressed;
			const schemaHash = createHash('sha256')
				.update(JSON.stringify({ fields: input.fields ?? [], recordCount: input.recordCount }))
				.digest('hex');
			const manifest: ResourceManifest = {
				storageVersion: this.encryptionKey ? 3 : 2,
				resourceId,
				contentType: input.contentType,
				originalHash,
				originalBytes: bytes,
				originalTokens: estimateTokens(input.content),
				createdAt: reused ? (existing?.createdAt ?? now.toISOString()) : now.toISOString(),
				lastAccessedAt: now.toISOString(),
				expiresAt: new Date(now.getTime() + input.ttlSeconds * 1000).toISOString(),
				scope: input.scope,
				reuseCount: reused ? (existing?.reuseCount ?? 0) + 1 : 0,
				referenceCount: reused ? (existing?.referenceCount ?? 1) + 1 : 1,
				sensitivity: secretLike ? 'secret_like_allowed' : 'standard',
				schemaHash,
				index: {
					fields: input.fields ?? [],
					...(input.recordCount === undefined ? {} : { recordCount: input.recordCount }),
				},
				fields: input.fields,
				recordCount: input.recordCount,
				provider: 'redis',
				...(this.encryptionKey ? { encryption: 'aes-256-gcm' as const } : {}),
			};
			await client.hSet(this.key(resourceId), {
				manifest: JSON.stringify(manifest),
				content: payload.toString('base64'),
			});
			await client.expire(this.key(resourceId), Math.max(1, Math.ceil(input.ttlSeconds)));
			return manifest;
		});
	}

	async inspect(resourceId: string, scope?: string): Promise<ResourceManifest> {
		const value = await (await this.client()).hGet(this.key(resourceId), 'manifest');
		if (!value) throw new ResourceNotFoundError(resourceId);
		const manifest = JSON.parse(value) as ResourceManifest;
		if (Date.parse(manifest.expiresAt) <= Date.now()) throw new ResourceExpiredError(resourceId);
		if (scope !== undefined && manifest.scope !== scope) throw new ResourceScopeError(resourceId);
		return manifest;
	}

	async read(resourceId: string, scope?: string): Promise<StoredResource> {
		const manifest = await this.inspect(resourceId, scope);
		const value = await (await this.client()).hGet(this.key(resourceId), 'content');
		if (!value) throw new ResourceNotFoundError(resourceId);
		const stored = Buffer.from(value, 'base64');
		if (isEncryptedEnvelope(stored) && !this.encryptionKey) {
			throw new Error('Storage encryption key is required for this resource');
		}
		const compressed = this.encryptionKey ? decryptEnvelope(stored, this.encryptionKey) : stored;
		const content = (await gunzipAsync(compressed)).toString('utf8');
		if (createHash('sha256').update(content).digest('hex') !== manifest.originalHash) {
			throw new ResourceIntegrityError(resourceId);
		}
		return { manifest, content };
	}

	async delete(resourceId: string, scope?: string): Promise<boolean> {
		if (scope !== undefined) await this.inspect(resourceId, scope);
		return (await (await this.client()).del(this.key(resourceId))) > 0;
	}

	async purgeExpired(): Promise<number> {
		const client = await this.client();
		let purged = 0;
		for await (const page of client.scanIterator({
			MATCH: `${this.prefix}:resource:ctx_*`,
			COUNT: 100,
		})) {
			for (const key of Array.isArray(page) ? page : [page]) {
				if ((await client.ttl(key)) === -1) {
					purged += await client.del(key);
				}
			}
		}
		return purged;
	}
}
