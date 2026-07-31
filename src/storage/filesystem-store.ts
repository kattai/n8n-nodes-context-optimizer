/* eslint-disable @n8n/community-nodes/require-node-api-error -- Storage core has no n8n execution context; node adapters wrap every error. */
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import { estimateTokens } from '../core/token-estimator';
import { createResourceId, assertResourceId } from './resource-id';
import type { ResourceManifest, ResourceStore, StoredResource, StoreResourceInput } from './types';
import { containsSecretLikeContent } from '../security/secret-detector';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export class ResourceExpiredError extends Error {
	constructor(resourceId: string) {
		super(`Resource expired: ${resourceId}`);
		this.name = 'ResourceExpiredError';
	}
}

export class ResourceNotFoundError extends Error {
	constructor(resourceId: string) {
		super(`Resource not found: ${resourceId}`);
		this.name = 'ResourceNotFoundError';
	}
}

export class ResourceIntegrityError extends Error {
	constructor(resourceId: string) {
		super(`Resource integrity check failed: ${resourceId}`);
		this.name = 'ResourceIntegrityError';
	}
}

export class ResourceScopeError extends Error {
	constructor(resourceId: string) {
		super(`Resource belongs to a different scope: ${resourceId}`);
		this.name = 'ResourceScopeError';
	}
}

export function defaultStorageDirectory(): string {
	const userFolder = process.env.N8N_USER_FOLDER?.trim() || join(homedir(), '.n8n');
	return join(userFolder, 'context-optimizer', 'resources');
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export class FileSystemResourceStore implements ResourceStore {
	private readonly root: string;

	constructor(
		rootDirectory = defaultStorageDirectory(),
		private readonly maxResourceBytes = 10 * 1024 * 1024,
	) {
		this.root = resolve(rootDirectory);
	}

	private path(resourceId: string, suffix: '.json.gz' | '.manifest.json'): string {
		assertResourceId(resourceId);
		const candidate = resolve(join(this.root, `${resourceId}${suffix}`));
		if (!candidate.startsWith(`${this.root}${sep}`)) {
			throw new Error('Resource path escapes storage directory');
		}
		return candidate;
	}

	private async writeAtomic(path: string, content: Buffer | string): Promise<void> {
		await mkdir(dirname(path), { recursive: true });
		const temporary = `${path}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, content, { flag: 'wx' });
			await rename(temporary, path);
		} catch (error) {
			await unlink(temporary).catch(() => undefined);
			throw error;
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

		const resourceId = createResourceId(input.content, input.scope);
		const dataPath = this.path(resourceId, '.json.gz');
		const manifestPath = this.path(resourceId, '.manifest.json');
		const createdAt = new Date();
		const originalHash = createHash('sha256').update(input.content).digest('hex');
		const schemaHash = createHash('sha256')
			.update(JSON.stringify({ fields: input.fields ?? [], recordCount: input.recordCount }))
			.digest('hex');
		let existingManifest: ResourceManifest | undefined;
		if ((await exists(dataPath)) && (await exists(manifestPath))) {
			try {
				existingManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ResourceManifest;
			} catch {
				existingManifest = undefined;
			}
		}
		const reused =
			existingManifest?.originalHash === originalHash && existingManifest.scope === input.scope;
		const manifest: ResourceManifest = {
			storageVersion: 2,
			resourceId,
			contentType: input.contentType,
			originalHash,
			originalBytes: bytes,
			originalTokens: estimateTokens(input.content),
			createdAt: reused
				? (existingManifest?.createdAt ?? createdAt.toISOString())
				: createdAt.toISOString(),
			lastAccessedAt: createdAt.toISOString(),
			expiresAt: new Date(createdAt.getTime() + input.ttlSeconds * 1000).toISOString(),
			scope: input.scope,
			reuseCount: reused ? (existingManifest?.reuseCount ?? 0) + 1 : 0,
			referenceCount: reused ? (existingManifest?.referenceCount ?? 1) + 1 : 1,
			sensitivity: secretLike ? 'secret_like_allowed' : 'standard',
			schemaHash,
			index: {
				fields: input.fields ?? [],
				...(input.recordCount === undefined ? {} : { recordCount: input.recordCount }),
			},
			fields: input.fields,
			recordCount: input.recordCount,
		};

		await mkdir(this.root, { recursive: true });
		if (!(await exists(dataPath))) {
			await this.writeAtomic(dataPath, await gzipAsync(Buffer.from(input.content, 'utf8')));
		}
		await this.writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
		return manifest;
	}

	async inspect(resourceId: string, scope?: string): Promise<ResourceManifest> {
		const path = this.path(resourceId, '.manifest.json');
		let manifest: ResourceManifest;
		try {
			manifest = JSON.parse(await readFile(path, 'utf8')) as ResourceManifest;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				throw new ResourceNotFoundError(resourceId);
			}
			throw error;
		}
		if (Date.parse(manifest.expiresAt) <= Date.now()) {
			throw new ResourceExpiredError(resourceId);
		}
		if (scope !== undefined && manifest.scope !== scope) {
			throw new ResourceScopeError(resourceId);
		}
		return manifest;
	}

	async read(resourceId: string, scope?: string): Promise<StoredResource> {
		const manifest = await this.inspect(resourceId, scope);
		const path = this.path(resourceId, '.json.gz');
		try {
			const compressed = await readFile(path);
			const content = (await gunzipAsync(compressed)).toString('utf8');
			const hash = createHash('sha256').update(content).digest('hex');
			if (hash !== manifest.originalHash) {
				throw new ResourceIntegrityError(resourceId);
			}
			const shouldRefreshAccess =
				!manifest.lastAccessedAt || Date.now() - Date.parse(manifest.lastAccessedAt) >= 60_000;
			const accessedManifest = shouldRefreshAccess
				? { ...manifest, lastAccessedAt: new Date().toISOString() }
				: manifest;
			if (shouldRefreshAccess) {
				await this.writeAtomic(
					this.path(resourceId, '.manifest.json'),
					`${JSON.stringify(accessedManifest, null, 2)}\n`,
				);
			}
			return { manifest: accessedManifest, content };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				throw new ResourceNotFoundError(resourceId);
			}
			throw error;
		}
	}

	async delete(resourceId: string, scope?: string): Promise<boolean> {
		if (scope !== undefined) await this.inspect(resourceId, scope);
		const paths = [this.path(resourceId, '.json.gz'), this.path(resourceId, '.manifest.json')];
		let deleted = false;
		for (const path of paths) {
			try {
				await unlink(path);
				deleted = true;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			}
		}
		return deleted;
	}

	async purgeExpired(now = new Date()): Promise<number> {
		await mkdir(this.root, { recursive: true });
		const entries = await readdir(this.root);
		const manifests = entries.filter((entry) => /^ctx_[a-f0-9]{24}\.manifest\.json$/.test(entry));
		let purged = 0;
		for (const entry of manifests) {
			const resourceId = entry.slice(0, -'.manifest.json'.length);
			try {
				const manifest = JSON.parse(
					await readFile(this.path(resourceId, '.manifest.json'), 'utf8'),
				) as ResourceManifest;
				if (Date.parse(manifest.expiresAt) <= now.getTime()) {
					if (await this.delete(resourceId)) purged++;
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			}
		}
		return purged;
	}
}
