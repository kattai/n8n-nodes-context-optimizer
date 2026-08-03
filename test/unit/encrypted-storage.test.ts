import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSystemResourceStore } from '../../src/storage/filesystem-store';

describe('encrypted filesystem storage', () => {
	it('encrypts at rest and decrypts with the same key', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'context-encrypted-'));
		try {
			const content = JSON.stringify({ id: 'SYN-42', value: 12850 });
			const store = new FileSystemResourceStore(directory, 1024 * 1024, 'synthetic-key-123456');
			const manifest = await store.store({
				content,
				contentType: 'json',
				ttlSeconds: 60,
				scope: 'workflow:session:user',
			});
			const storedBytes = await readFile(join(directory, `${manifest.resourceId}.json.gz`));
			expect(storedBytes.subarray(0, 4).toString('ascii')).toBe('CSE1');
			expect(storedBytes.toString('utf8')).not.toContain('SYN-42');
			expect((await store.read(manifest.resourceId, 'workflow:session:user')).content).toBe(
				content,
			);
			expect(manifest.encryption).toBe('aes-256-gcm');
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('rejects a missing or wrong key', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'context-encrypted-key-'));
		try {
			const writer = new FileSystemResourceStore(directory, 1024 * 1024, 'correct-key-123456');
			const manifest = await writer.store({
				content: 'synthetic protected value',
				contentType: 'text',
				ttlSeconds: 60,
				scope: 'isolated',
			});
			await expect(
				new FileSystemResourceStore(directory).read(manifest.resourceId, 'isolated'),
			).rejects.toThrow('Storage encryption key is required');
			await expect(
				new FileSystemResourceStore(directory, 1024 * 1024, 'wrong-key-12345678').read(
					manifest.resourceId,
					'isolated',
				),
			).rejects.toThrow('Storage decryption failed');
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
