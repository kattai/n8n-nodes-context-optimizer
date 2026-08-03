function encoded(value: string): string {
	return Buffer.from(value, 'utf8').toString('base64url');
}

export function buildIsolationScope(
	scopeInput: string,
	sessionIdInput?: string,
	ownerIdInput?: string,
): string {
	const scope = scopeInput.trim();
	if (!scope) throw new Error('scope is required');
	const sessionId = sessionIdInput?.trim() ?? '';
	const ownerId = ownerIdInput?.trim() ?? '';
	if (!sessionId && !ownerId) return scope;
	return `isolation:v1:${encoded(scope)}:${encoded(sessionId)}:${encoded(ownerId)}`;
}
