import { describe, expect, it } from 'vitest';
import { createConfiguredResourceStore } from '../../src/storage/configured-store';
import { FileSystemResourceStore } from '../../src/storage/filesystem-store';
import { RedisResourceStore } from '../../src/storage/redis-store';

describe('configured resource store', () => {
	it('keeps zero-credential filesystem as default', () => {
		expect(createConfiguredResourceStore({})).toBeInstanceOf(FileSystemResourceStore);
	});

	it('requires credentials only for encryption or Redis', () => {
		expect(() => createConfiguredResourceStore({ encrypt: true })).toThrow(
			'Select Context Saver Storage credentials',
		);
		expect(() => createConfiguredResourceStore({ provider: 'redis' })).toThrow(
			'Select Context Saver Storage credentials',
		);
		expect(
			createConfiguredResourceStore({
				provider: 'redis',
				credentials: { redisUrl: 'redis://localhost:6379' },
			}),
		).toBeInstanceOf(RedisResourceStore);
	});
});
