export function memoryObject(value: unknown, fieldName: string): Record<string, unknown> {
	if (value === undefined || value === null || value === '') return {};
	const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error(`${fieldName} must be a JSON object`);
	}
	return parsed as Record<string, unknown>;
}

export function memoryArray(value: unknown, fieldName: string): unknown[] {
	if (value === undefined || value === null || value === '') return [];
	const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
	if (!Array.isArray(parsed)) throw new Error(`${fieldName} must be a JSON array`);
	return parsed;
}
