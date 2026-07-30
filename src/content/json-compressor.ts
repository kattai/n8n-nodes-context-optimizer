import type { CompressorResult, ContentOptimizationOptions } from './types';

function cleanValue(
	value: unknown,
	options: ContentOptimizationOptions,
	depth = 0,
): unknown {
	if (Array.isArray(value)) {
		return value
			.map((entry) => cleanValue(entry, options, depth + 1))
			.filter((entry) => entry !== undefined);
	}
	if (!value || typeof value !== 'object') return value;
	const include = new Set(options.includeFields ?? []);
	const exclude = new Set(options.excludeFields ?? []);
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([key]) => depth > 0 || include.size === 0 || include.has(key))
		.filter(([key]) => depth > 0 || !exclude.has(key))
		.map(([key, entry]) => [key, cleanValue(entry, options, depth + 1)] as const)
		.filter(([, entry]) => !(options.removeNulls && entry === null))
		.filter(([, entry]) => !(options.removeEmptyStrings && entry === ''));
	return Object.fromEntries(entries);
}

function tabularRecords(
	records: Array<Record<string, unknown>>,
	path?: string,
	metadata?: Record<string, unknown>,
): CompressorResult {
	const fields: string[] = [];
	const fieldSet = new Set<string>();
	for (const record of records) {
		for (const field of Object.keys(record)) {
			if (!fieldSet.has(field)) {
				fieldSet.add(field);
				fields.push(field);
			}
		}
	}
	const rows = records.map((record) =>
		JSON.stringify(fields.map((field) => record[field] ?? null)),
	);
	const header = [
		'@json-table',
		...(path ? [`path:${JSON.stringify(path)}`] : []),
		...(metadata && Object.keys(metadata).length > 0
			? [`metadata:${JSON.stringify(metadata)}`]
			: []),
		`fields:${JSON.stringify(fields)}`,
	];
	return {
		content: [...header, ...rows].join('\n'),
		strategies: ['json-clean', 'shared-schema', 'json-table'],
		recordCount: records.length,
		fields,
		format: 'json-table',
	};
}

export function compressJson(
	content: string,
	options: ContentOptimizationOptions,
): CompressorResult {
	const parsed = cleanValue(JSON.parse(content), options);
	if (
		Array.isArray(parsed) &&
		parsed.length > 1 &&
		parsed.every((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
	) {
		return tabularRecords(parsed as Array<Record<string, unknown>>);
	}
	if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
		const object = parsed as Record<string, unknown>;
		const nestedTable = Object.entries(object)
			.filter(
				(entry): entry is [string, Array<Record<string, unknown>>] =>
					Array.isArray(entry[1]) &&
					entry[1].length > 1 &&
					entry[1].every(
						(value) => value && typeof value === 'object' && !Array.isArray(value),
					),
			)
			.sort((left, right) => right[1].length - left[1].length)[0];
		if (nestedTable) {
			const [path, records] = nestedTable;
			const metadata = Object.fromEntries(
				Object.entries(object).filter(([key]) => key !== path),
			);
			return tabularRecords(records, path, metadata);
		}
	}
	return {
		content: JSON.stringify(parsed),
		strategies: ['json-clean', 'json-minify'],
		recordCount: Array.isArray(parsed) ? parsed.length : undefined,
		fields:
			parsed && typeof parsed === 'object' && !Array.isArray(parsed)
				? Object.keys(parsed as Record<string, unknown>)
				: undefined,
		format: 'json',
	};
}
