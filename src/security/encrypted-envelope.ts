import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const MAGIC = Buffer.from('CSE1', 'ascii');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function keyBytes(secret: string): Buffer {
	if (secret.length < 16) throw new Error('Storage encryption key must contain at least 16 characters');
	return createHash('sha256').update(secret, 'utf8').digest();
}

export function isEncryptedEnvelope(value: Buffer): boolean {
	return value.length >= MAGIC.length && value.subarray(0, MAGIC.length).equals(MAGIC);
}

export function encryptEnvelope(value: Buffer, secret: string): Buffer {
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv('aes-256-gcm', keyBytes(secret), iv);
	const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
	return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
}

export function decryptEnvelope(value: Buffer, secret: string): Buffer {
	if (!isEncryptedEnvelope(value)) return value;
	const minimum = MAGIC.length + IV_LENGTH + TAG_LENGTH;
	if (value.length < minimum) throw new Error('Encrypted storage envelope is truncated');
	const ivStart = MAGIC.length;
	const tagStart = ivStart + IV_LENGTH;
	const dataStart = tagStart + TAG_LENGTH;
	const decipher = createDecipheriv(
		'aes-256-gcm',
		keyBytes(secret),
		value.subarray(ivStart, tagStart),
	);
	decipher.setAuthTag(value.subarray(tagStart, dataStart));
	try {
		return Buffer.concat([decipher.update(value.subarray(dataStart)), decipher.final()]);
	} catch {
		// Core utility: callers translate this integrity failure into a node-specific error.
		// eslint-disable-next-line @n8n/community-nodes/require-node-api-error
		throw new Error('Storage decryption failed: wrong key or corrupted content');
	}
}
