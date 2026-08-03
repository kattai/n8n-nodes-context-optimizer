import { defaultStorageDirectory, FileSystemResourceStore } from './filesystem-store';
import { RedisResourceStore } from './redis-store';
import type { ResourceStore } from './types';

export type StorageProvider = 'filesystem' | 'redis';

export interface StorageCredentialValues {
	redisUrl?: unknown;
	redisUsername?: unknown;
	redisPassword?: unknown;
	encryptionKey?: unknown;
}

export interface ConfiguredStoreOptions {
	provider?: StorageProvider;
	directory?: string;
	maxResourceBytes?: number;
	encrypt?: boolean;
	redisKeyPrefix?: string;
	credentials?: StorageCredentialValues;
}

function credentialText(value: unknown): string {
	return String(value ?? '').trim();
}

export function createConfiguredResourceStore(options: ConfiguredStoreOptions): ResourceStore {
	const provider = options.provider ?? 'filesystem';
	const encryptionKey = options.encrypt
		? credentialText(options.credentials?.encryptionKey)
		: undefined;
	if (options.encrypt && !encryptionKey) {
		throw new Error('Select Context Saver Storage API credentials with an encryption key');
	}
	const maximum = options.maxResourceBytes ?? 10 * 1024 * 1024;
	if (provider === 'filesystem') {
		return new FileSystemResourceStore(
			options.directory?.trim() || defaultStorageDirectory(),
			maximum,
			encryptionKey,
		);
	}
	const url = credentialText(options.credentials?.redisUrl);
	if (!url) throw new Error('Select Context Saver Storage API credentials with a Redis URL');
	return new RedisResourceStore(
		{
			url,
			username: credentialText(options.credentials?.redisUsername) || undefined,
			password: credentialText(options.credentials?.redisPassword) || undefined,
			keyPrefix: options.redisKeyPrefix?.trim() || 'context-saver',
		},
		maximum,
		encryptionKey,
	);
}
