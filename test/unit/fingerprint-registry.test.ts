import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileSystemFingerprintRegistry } from '../../src/cache/fingerprint-registry';

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'context-cache-fingerprints-'));
	directories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe('FileSystemFingerprintRegistry', () => {
	it('persists repetition metadata without raw content', async () => {
		const directory = await temporaryDirectory();
		const registry = new FileSystemFingerprintRegistry(directory, {
			ttlHours: 24,
			maxEntries: 100,
		});
		const input = {
			scope: 'workflow:agent:model',
			position: 'messages[2].content',
			content: 'PRIVATE CUSTOMER CONTENT 998877',
			estimatedTokens: 2048,
		};
		const first = await registry.observe(input, new Date('2026-07-30T10:00:00Z'));
		const second = await registry.observe(
			{ ...input, providerCachedTokens: 1900 },
			new Date('2026-07-30T10:05:00Z'),
		);

		expect(second).toMatchObject({
			fingerprint: first.fingerprint,
			scope: input.scope,
			estimatedTokens: 2048,
			seenCount: 2,
			firstSeenAt: '2026-07-30T10:00:00.000Z',
			lastSeenAt: '2026-07-30T10:05:00.000Z',
			lastProviderCachedTokens: 1900,
		});
		const files = await readdir(directory);
		expect(files).toHaveLength(1);
		const stored = await readFile(join(directory, files[0]), 'utf8');
		expect(stored).not.toContain(input.content);
		expect(stored).not.toContain('998877');
		expect(JSON.parse(stored)).toEqual(second);
	});

	it('serializes concurrent observations without losing counts', async () => {
		const registry = new FileSystemFingerprintRegistry(await temporaryDirectory(), {
			ttlHours: 24,
			maxEntries: 100,
		});
		const input = {
			scope: 'workflow:agent:model',
			position: 'messages[4].content',
			content: 'same repeated block',
			estimatedTokens: 3000,
		};

		const records = await Promise.all(
			Array.from({ length: 20 }, (_, index) =>
				registry.observe(input, new Date(Date.UTC(2026, 6, 30, 10, 0, index))),
			),
		);
		const stored = await registry.get(records[0].fingerprint);

		expect(stored?.seenCount).toBe(20);
	});

	it('records provider cache evidence without incrementing repetition counts', async () => {
		const registry = new FileSystemFingerprintRegistry(await temporaryDirectory());
		const observed = await registry.observe({
			scope: 'scope',
			position: 'messages[0].content',
			content: 'stable provider prefix',
			estimatedTokens: 2_500,
		});

		await registry.recordProviderCache([observed.fingerprint], 2_200);
		const updated = await registry.get(observed.fingerprint);

		expect(updated).toMatchObject({ seenCount: 1, lastProviderCachedTokens: 2_200 });
	});

	it('expires records and purges only the configured batch', async () => {
		const registry = new FileSystemFingerprintRegistry(await temporaryDirectory(), {
			ttlHours: 1,
			maxEntries: 100,
			purgeLimit: 1,
		});
		const observedAt = new Date('2026-07-30T10:00:00Z');
		const records = await Promise.all([
			registry.observe(
				{ scope: 'scope', position: 'a', content: 'first', estimatedTokens: 100 },
				observedAt,
			),
			registry.observe(
				{ scope: 'scope', position: 'b', content: 'second', estimatedTokens: 100 },
				observedAt,
			),
		]);
		const later = new Date('2026-07-30T12:00:00Z');

		expect(await registry.purgeExpired(later)).toBe(1);
		expect(await registry.get(records[0].fingerprint, later)).toBeUndefined();
		expect(await registry.get(records[1].fingerprint, later)).toBeUndefined();
	});

	it('enforces a maximum number of records by removing least-recently-seen entries', async () => {
		const registry = new FileSystemFingerprintRegistry(await temporaryDirectory(), {
			ttlHours: 24,
			maxEntries: 2,
		});
		const records = [];
		for (let index = 0; index < 3; index++) {
			records.push(
				await registry.observe(
					{
						scope: 'scope',
						position: String(index),
						content: `record-${index}`,
						estimatedTokens: 100,
					},
					new Date(Date.UTC(2026, 6, 30, 10, 0, index)),
				),
			);
		}

		expect(await registry.get(records[0].fingerprint)).toBeUndefined();
		expect(await registry.get(records[1].fingerprint)).toBeDefined();
		expect(await registry.get(records[2].fingerprint)).toBeDefined();
	});

	it('rejects invalid registry configuration and fingerprints', async () => {
		expect(
			() =>
				new FileSystemFingerprintRegistry('unused', {
					ttlHours: 0,
					maxEntries: 100,
				}),
		).toThrow('ttlHours must be between 1 and 720');
		const registry = new FileSystemFingerprintRegistry(await temporaryDirectory());
		await expect(registry.get('../outside')).rejects.toThrow('Invalid cache fingerprint');
	});
});
