/* eslint-disable @n8n/community-nodes/require-node-api-error -- Cache core has no n8n execution context; node adapters wrap every error. */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { assertCacheFingerprint, createCacheFingerprint } from './fingerprint';
import type {
	FingerprintRecord,
	FingerprintRegistry,
	FingerprintRegistryOptions,
	ObserveFingerprintInput,
} from './types';

const DEFAULT_TTL_HOURS = 24;
const DEFAULT_MAX_ENTRIES = 5_000;
const DEFAULT_PURGE_LIMIT = 100;

export function defaultFingerprintDirectory(): string {
	const userFolder = process.env.N8N_USER_FOLDER?.trim() || join(homedir(), '.n8n');
	return join(userFolder, 'context-optimizer', 'fingerprints');
}

function validateInteger(name: string, value: number): void {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${name} must be a positive integer`);
	}
}

export class FileSystemFingerprintRegistry implements FingerprintRegistry {
	private readonly root: string;

	private readonly ttlMilliseconds: number;

	private readonly maxEntries: number;

	private readonly purgeLimit: number;

	private mutationQueue: Promise<void> = Promise.resolve();

	constructor(
		rootDirectory = defaultFingerprintDirectory(),
		options: FingerprintRegistryOptions = {},
	) {
		const ttlHours = options.ttlHours ?? DEFAULT_TTL_HOURS;
		if (!Number.isFinite(ttlHours) || ttlHours < 1 || ttlHours > 720) {
			throw new Error('ttlHours must be between 1 and 720');
		}
		this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
		this.purgeLimit = options.purgeLimit ?? DEFAULT_PURGE_LIMIT;
		validateInteger('maxEntries', this.maxEntries);
		validateInteger('purgeLimit', this.purgeLimit);
		this.root = resolve(rootDirectory);
		this.ttlMilliseconds = ttlHours * 60 * 60 * 1_000;
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.mutationQueue.then(operation, operation);
		this.mutationQueue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	private path(fingerprint: string): string {
		assertCacheFingerprint(fingerprint);
		const candidate = resolve(join(this.root, `${fingerprint}.json`));
		if (!candidate.startsWith(`${this.root}${sep}`)) {
			throw new Error('Cache fingerprint path escapes storage directory');
		}
		return candidate;
	}

	private async readRecord(fingerprint: string): Promise<FingerprintRecord | undefined> {
		try {
			return JSON.parse(await readFile(this.path(fingerprint), 'utf8')) as FingerprintRecord;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
			throw error;
		}
	}

	private async writeAtomic(path: string, record: FingerprintRecord): Promise<void> {
		await mkdir(dirname(path), { recursive: true });
		const temporary = `${path}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, `${JSON.stringify(record)}\n`, { flag: 'wx' });
			await rename(temporary, path);
		} catch (error) {
			await unlink(temporary).catch(() => undefined);
			throw error;
		}
	}

	private async listRecords(): Promise<FingerprintRecord[]> {
		await mkdir(this.root, { recursive: true });
		const files = (await readdir(this.root)).filter((entry) => /^cf_[a-f0-9]{64}\.json$/.test(entry));
		const records: FingerprintRecord[] = [];
		for (const file of files) {
			const fingerprint = file.slice(0, -'.json'.length);
			const record = await this.readRecord(fingerprint);
			if (record) records.push(record);
		}
		return records;
	}

	private async enforceMaxEntries(): Promise<void> {
		const records = await this.listRecords();
		const overflow = records.length - this.maxEntries;
		if (overflow <= 0) return;
		records.sort((left, right) => Date.parse(left.lastSeenAt) - Date.parse(right.lastSeenAt));
		for (const record of records.slice(0, overflow)) {
			await unlink(this.path(record.fingerprint)).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== 'ENOENT') throw error;
			});
		}
	}

	async observe(input: ObserveFingerprintInput, now = new Date()): Promise<FingerprintRecord> {
		return await this.enqueue(async () => {
			if (!Number.isFinite(input.estimatedTokens) || input.estimatedTokens < 0) {
				throw new Error('estimatedTokens must be zero or greater');
			}
			const fingerprint = createCacheFingerprint(input);
			const existing = await this.readRecord(fingerprint);
			const nowIso = now.toISOString();
			const activeExisting =
				existing && Date.parse(existing.expiresAt) > now.getTime() ? existing : undefined;
			const record: FingerprintRecord = {
				storageVersion: 1,
				fingerprint,
				scope: input.scope,
				estimatedTokens: input.estimatedTokens,
				seenCount: (activeExisting?.seenCount ?? 0) + 1,
				firstSeenAt: activeExisting?.firstSeenAt ?? nowIso,
				lastSeenAt: nowIso,
				expiresAt: new Date(now.getTime() + this.ttlMilliseconds).toISOString(),
				...(input.providerCachedTokens !== undefined
					? { lastProviderCachedTokens: input.providerCachedTokens }
					: activeExisting?.lastProviderCachedTokens !== undefined
						? { lastProviderCachedTokens: activeExisting.lastProviderCachedTokens }
						: {}),
			};
			await this.writeAtomic(this.path(fingerprint), record);
			await this.enforceMaxEntries();
			return record;
		});
	}

	async get(fingerprint: string, now = new Date()): Promise<FingerprintRecord | undefined> {
		return await this.enqueue(async () => {
			assertCacheFingerprint(fingerprint);
			const record = await this.readRecord(fingerprint);
			if (!record) return undefined;
			if (Date.parse(record.expiresAt) <= now.getTime()) {
				await unlink(this.path(fingerprint)).catch((error: NodeJS.ErrnoException) => {
					if (error.code !== 'ENOENT') throw error;
				});
				return undefined;
			}
			return record;
		});
	}

	async recordProviderCache(
		fingerprints: string[],
		cachedTokens: number,
		now = new Date(),
	): Promise<void> {
		await this.enqueue(async () => {
			if (!Number.isFinite(cachedTokens) || cachedTokens < 0) {
				throw new Error('cachedTokens must be zero or greater');
			}
			for (const fingerprint of [...new Set(fingerprints)]) {
				assertCacheFingerprint(fingerprint);
				const record = await this.readRecord(fingerprint);
				if (!record || Date.parse(record.expiresAt) <= now.getTime()) continue;
				await this.writeAtomic(this.path(fingerprint), {
					...record,
					lastProviderCachedTokens: cachedTokens,
				});
			}
		});
	}

	async purgeExpired(now = new Date()): Promise<number> {
		return await this.enqueue(async () => {
			const records = await this.listRecords();
			const expired = records
				.filter((record) => Date.parse(record.expiresAt) <= now.getTime())
				.sort((left, right) => Date.parse(left.expiresAt) - Date.parse(right.expiresAt))
				.slice(0, this.purgeLimit);
			for (const record of expired) {
				await unlink(this.path(record.fingerprint)).catch((error: NodeJS.ErrnoException) => {
					if (error.code !== 'ENOENT') throw error;
				});
			}
			return expired.length;
		});
	}
}
