function stableValue(value: unknown, seen: WeakSet<object>): unknown {
	if (value === null || typeof value !== 'object') return value;
	if (seen.has(value)) return '[Circular]';
	seen.add(value);

	if (Array.isArray(value)) return value.map((entry) => stableValue(entry, seen));

	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, stableValue(entry, seen)]),
	);
}

export function stableStringify(value: unknown): string {
	return JSON.stringify(stableValue(value, new WeakSet()), null, 0);
}

export function normalizeSection(value: unknown): string {
	if (value === undefined || value === null) return '';
	if (typeof value === 'string') return value.trim();
	if (Array.isArray(value)) {
		return value
			.map((entry) => (typeof entry === 'string' ? entry.trim() : stableStringify(entry)))
			.filter(Boolean)
			.join('\n');
	}
	return stableStringify(value);
}

export function splitUnits(text: string): string[] {
	if (!text.trim()) return [];
	const lines = text
		.split(/\r?\n+/)
		.map((line) => line.trim())
		.filter(Boolean);

	if (lines.length > 1) return lines;

	return text
		.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ú0-9])/u)
		.map((unit) => unit.trim())
		.filter(Boolean);
}
