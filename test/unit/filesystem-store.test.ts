import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
	FileSystemResourceStore,
	ResourceExpiredError,
	ResourceIntegrityError,
	ResourceScopeError,
} from '../../src/storage/filesystem-store';

const directories: string[] = [];
const gzipAsync = promisify(gzip);

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'context-optimizer-'));
	directories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe('FileSystemResourceStore', () => {
	it('stores gzip content and retrieves it exactly', async () => {
		const directory = await temporaryDirectory();
		const store = new FileSystemResourceStore(directory);
		const content = JSON.stringify([{ id: 'ORD-1', total: 12850 }]);

		const manifest = await store.store({
			content,
			contentType: 'json',
			ttlSeconds: 3600,
			scope: 'workflow-1',
			fields: ['id', 'total'],
			recordCount: 1,
		});
		const resource = await store.read(manifest.resourceId);

		expect(resource.content).toBe(content);
		expect(resource.manifest.fields).toEqual(['id', 'total']);
		expect(resource.manifest.recordCount).toBe(1);
		const compressed = await readFile(join(directory, `${manifest.resourceId}.json.gz`));
		expect(compressed.equals(Buffer.from(content))).toBe(false);
	});

	it('rejects invalid IDs and path traversal', async () => {
		const directory = await temporaryDirectory();
		const store = new FileSystemResourceStore(directory);

		await expect(store.read('../outside')).rejects.toThrow('Invalid resourceId');
	});

	it('rejects expired resources and purges their files', async () => {
		const directory = await temporaryDirectory();
		const store = new FileSystemResourceStore(directory);
		const manifest = await store.store({
			content: 'expiring',
			contentType: 'text',
			ttlSeconds: 1,
			scope: 'workflow-1',
		});
		const path = join(directory, `${manifest.resourceId}.manifest.json`);
		const expired = {
			...manifest,
			expiresAt: new Date(0).toISOString(),
		};
		await writeFile(path, JSON.stringify(expired));

		await expect(store.read(manifest.resourceId)).rejects.toBeInstanceOf(ResourceExpiredError);
		expect(await store.purgeExpired()).toBe(1);
		expect(await store.delete(manifest.resourceId)).toBe(false);
	});

	it('enforces maximum resource size', async () => {
		const directory = await temporaryDirectory();
		const store = new FileSystemResourceStore(directory, 5);

		await expect(
			store.store({
				content: '123456',
				contentType: 'text',
				ttlSeconds: 3600,
				scope: 'workflow-1',
			}),
		).rejects.toThrow('Resource exceeds maximum size');
	});

	it('rejects stored content when its SHA-256 no longer matches the manifest', async () => {
		const directory = await temporaryDirectory();
		const store = new FileSystemResourceStore(directory);
		const manifest = await store.store({
			content: 'original content',
			contentType: 'text',
			ttlSeconds: 3600,
			scope: 'workflow-1',
		});
		await writeFile(
			join(directory, `${manifest.resourceId}.json.gz`),
			await gzipAsync('tampered content'),
		);

		await expect(store.read(manifest.resourceId)).rejects.toBeInstanceOf(ResourceIntegrityError);
	});

	it('reuses the same content-addressed resource and increments reuse metadata', async () => {
		const directory = await temporaryDirectory();
		const store = new FileSystemResourceStore(directory);
		const input = {
			content: JSON.stringify({ id: 'ORD-1', status: 'open' }),
			contentType: 'json' as const,
			ttlSeconds: 3600,
			scope: 'workflow-1',
		};
		const first = await store.store(input);
		const second = await store.store(input);

		expect(second.resourceId).toBe(first.resourceId);
		expect(second.createdAt).toBe(first.createdAt);
		expect(second.reuseCount).toBe(1);
		expect(second.referenceCount).toBe(2);
		expect((await store.read(second.resourceId, 'workflow-1')).content).toBe(input.content);
	});

	it('records the last successful access after integrity and scope checks', async () => {
		const directory = await temporaryDirectory();
		const store = new FileSystemResourceStore(directory);
		const manifest = await store.store({
			content: 'access tracking',
			contentType: 'text',
			ttlSeconds: 3600,
			scope: 'workflow-1',
		});
		const manifestPath = join(directory, `${manifest.resourceId}.manifest.json`);
		await writeFile(
			manifestPath,
			JSON.stringify({ ...manifest, lastAccessedAt: new Date(0).toISOString() }),
		);

		const resource = await store.read(manifest.resourceId, 'workflow-1');

		expect(resource.manifest.lastAccessedAt).not.toBe(new Date(0).toISOString());
		expect(
			(JSON.parse(await readFile(manifestPath, 'utf8')) as { lastAccessedAt: string })
				.lastAccessedAt,
		).toBe(resource.manifest.lastAccessedAt);
	});

	it('blocks cross-scope reads and deletes inside the storage layer', async () => {
		const directory = await temporaryDirectory();
		const store = new FileSystemResourceStore(directory);
		const manifest = await store.store({
			content: 'scoped content',
			contentType: 'text',
			ttlSeconds: 3600,
			scope: 'workflow-1',
		});

		await expect(store.read(manifest.resourceId, 'workflow-2')).rejects.toBeInstanceOf(
			ResourceScopeError,
		);
		await expect(store.delete(manifest.resourceId, 'workflow-2')).rejects.toBeInstanceOf(
			ResourceScopeError,
		);
		expect((await store.read(manifest.resourceId, 'workflow-1')).content).toBe('scoped content');
	});

	it('blocks secret-like content unless explicitly allowed', async () => {
		const directory = await temporaryDirectory();
		const store = new FileSystemResourceStore(directory);
		const input = {
			content: JSON.stringify({ apiKey: 'sk_live_1234567890abcdef' }),
			contentType: 'json' as const,
			ttlSeconds: 3600,
			scope: 'workflow-1',
		};
		await expect(store.store(input)).rejects.toThrow('Secret-like content is blocked');
		const allowed = await store.store({ ...input, allowSecretLikeContent: true });
		expect(allowed.sensitivity).toBe('secret_like_allowed');
	});
});
