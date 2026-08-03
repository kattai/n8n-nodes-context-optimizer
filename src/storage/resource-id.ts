import { createHash } from 'node:crypto';

const resourceIdPattern = /^ctx_[a-f0-9]{24}$/;

export function createResourceId(content: string, scope: string, storageVariant = 'plain'): string {
	const builder = createHash('sha256').update(scope).update('\0');
	if (storageVariant !== 'plain') builder.update(storageVariant).update('\0');
	const hash = builder.update(content).digest('hex');
	return `ctx_${hash.slice(0, 24)}`;
}

export function assertResourceId(resourceId: string): void {
	if (!resourceIdPattern.test(resourceId)) {
		throw new Error('Invalid resourceId');
	}
}
