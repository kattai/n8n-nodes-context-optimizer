import { estimateTokens } from '../core/token-estimator';
import { packJson } from './json-packing';
import { jsonRoundTripMatches } from './json-roundtrip';
import type { CompressorResult, ContentOptimizationOptions } from './types';

function jsonPathPattern(pattern: string): RegExp {
	const normalized = pattern
		.trim()
		.replace(/^\$?\.?/, '$.')
		.replace(/^\.$/, '$');
	const escaped = normalized
		.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
		.replace(/\\\[\*\\\]/g, '\\[\\d+\\\]')
		.replace(/\*/g, '[^.\\[\\]]+');
	return new RegExp(`^${escaped}$`);
}

function matchesPath(path: string, patterns: string[]): boolean {
	return patterns.some((pattern) => jsonPathPattern(pattern).test(path));
}

function pathCanContain(path: string, patterns: string[]): boolean {
	return patterns.some((pattern) => {
		const normalized = pattern.trim().replace(/^\$?\.?/, '$.');
		return normalized.startsWith(`${path}.`) || normalized.startsWith(`${path}[`);
	});
}

export function cleanJsonValue(
	value: unknown,
	options: ContentOptimizationOptions,
	path = '$',
	depth = 0,
): unknown {
	const protectedPaths = options.protectedJsonPaths ?? [];
	const includePaths = options.includeJsonPaths ?? [];
	const excludePaths = options.excludeJsonPaths ?? [];
	const protectedHere = matchesPath(path, protectedPaths);
	if (!protectedHere && matchesPath(path, excludePaths)) return undefined;
	if (
		!protectedHere &&
		includePaths.length > 0 &&
		!matchesPath(path, includePaths) &&
		!pathCanContain(path, includePaths)
	) {
		return undefined;
	}
	if (Array.isArray(value)) {
		return value.map((entry, index) =>
			cleanJsonValue(entry, options, `${path}[${index}]`, depth + 1),
		);
	}
	if (!value || typeof value !== 'object') return value;
	const include = new Set(options.includeFields ?? []);
	const exclude = new Set(options.excludeFields ?? []);
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([key]) => depth > 0 || include.size === 0 || include.has(key))
		.filter(([key]) => depth > 0 || !exclude.has(key))
		.map(([key, entry]) => {
			const childPath = `${path}.${key}`;
			return [key, cleanJsonValue(entry, options, childPath, depth + 1)] as const;
		})
		.filter(([, entry]) => entry !== undefined)
		.filter(([key, entry]) => {
			const childPath = `${path}.${key}`;
			return !(options.removeNulls && entry === null && !matchesPath(childPath, protectedPaths));
		})
		.filter(([key, entry]) => {
			const childPath = `${path}.${key}`;
			return !(
				options.removeEmptyStrings &&
				entry === '' &&
				!matchesPath(childPath, protectedPaths)
			);
		});
	return Object.fromEntries(entries);
}

function legacyTabularRecords(
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
		JSON.stringify(
			fields.map((field) =>
				Object.prototype.hasOwnProperty.call(record, field) ? record[field] : { $cs: 'missing' },
			),
		),
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
	const parsed = cleanJsonValue(JSON.parse(content), options);
	const minified = JSON.stringify(parsed);
	const candidates: CompressorResult[] = [
		{
			content: minified,
			strategies: ['json-clean', 'json-minify'],
			recordCount: Array.isArray(parsed) ? parsed.length : undefined,
			fields:
				parsed && typeof parsed === 'object' && !Array.isArray(parsed)
					? Object.keys(parsed as Record<string, unknown>)
					: undefined,
			format: 'json',
		},
	];

	if (
		Array.isArray(parsed) &&
		parsed.length > 1 &&
		parsed.every((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
	) {
		candidates.push(legacyTabularRecords(parsed as Array<Record<string, unknown>>));
	} else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
		const object = parsed as Record<string, unknown>;
		const nestedTable = Object.entries(object)
			.filter(
				(entry): entry is [string, Array<Record<string, unknown>>] =>
					Array.isArray(entry[1]) &&
					entry[1].length > 1 &&
					entry[1].every((value) => value && typeof value === 'object' && !Array.isArray(value)),
			)
			.sort((left, right) => right[1].length - left[1].length)[0];
		if (nestedTable) {
			const [path, records] = nestedTable;
			const metadata = Object.fromEntries(Object.entries(object).filter(([key]) => key !== path));
			candidates.push(legacyTabularRecords(records, path, metadata));
		}
	}

	const packed = packJson(parsed, options.dictionaryEncoding !== false);
	if (packed.tableCount > 0 && jsonRoundTripMatches(parsed, packed.content)) {
		candidates.push({
			content: packed.content,
			strategies: [
				'json-clean',
				'json-pack-v2',
				'shared-schema-recursive',
				...(packed.dictionaryApplied ? ['dictionary-encoding'] : []),
			],
			recordCount: packed.recordCount,
			fields: packed.fields,
			format: 'json-pack-v2',
			roundTripVerified: true,
		});
	}

	return candidates.sort(
		(left, right) => estimateTokens(left.content) - estimateTokens(right.content),
	)[0];
}
