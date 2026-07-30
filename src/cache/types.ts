export interface CacheFingerprintSource {
	scope: string;
	position: string;
	content: string;
}

export interface ObserveFingerprintInput extends CacheFingerprintSource {
	estimatedTokens: number;
	providerCachedTokens?: number;
}

export interface FingerprintRecord {
	storageVersion: 1;
	fingerprint: string;
	scope: string;
	estimatedTokens: number;
	seenCount: number;
	firstSeenAt: string;
	lastSeenAt: string;
	expiresAt: string;
	lastProviderCachedTokens?: number;
}

export interface FingerprintRegistryOptions {
	ttlHours?: number;
	maxEntries?: number;
	purgeLimit?: number;
}
