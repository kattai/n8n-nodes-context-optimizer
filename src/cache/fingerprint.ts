import { createHash } from 'node:crypto';
import type { CacheFingerprintSource } from './types';

const fingerprintPattern = /^cf_[a-f0-9]{64}$/;

export function createCacheFingerprint(input: CacheFingerprintSource): string {
	const hash = createHash('sha256')
		.update(input.scope)
		.update('\0')
		.update(input.position)
		.update('\0')
		.update(input.content)
		.digest('hex');
	return `cf_${hash}`;
}

export function assertCacheFingerprint(fingerprint: string): void {
	if (!fingerprintPattern.test(fingerprint)) {
		throw new Error('Invalid cache fingerprint');
	}
}
