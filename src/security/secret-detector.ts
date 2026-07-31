export function containsSecretLikeContent(content: string): boolean {
	return [
		/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
		/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
		/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{12,}/i,
		/["'](?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization)["']\s*:\s*["'][^"']{6,}["']/i,
	].some((pattern) => pattern.test(content));
}
