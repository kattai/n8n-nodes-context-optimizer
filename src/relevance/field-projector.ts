import { tokenizeSearchText } from './bm25';

export interface FieldProjectionOptions {
	query: string;
	protectedPaths?: string[];
	alwaysIncludePaths?: string[];
	maximumFields?: number;
}

export interface FieldProjectionResult {
	projected: unknown;
	includedPaths: string[];
	omittedPaths: string[];
	recoverable: true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function flatten(
	value: unknown,
	path = '$',
	output = new Map<string, unknown>(),
): Map<string, unknown> {
	if (!isRecord(value)) return output;
	for (const [key, entry] of Object.entries(value)) {
		const childPath = `${path}.${key}`;
		output.set(childPath, entry);
	}
	return output;
}

function rootField(path: string): string {
	return path.replace(/^\$\./, '').split(/[.[]/)[0];
}

export function projectFields(
	value: unknown,
	options: FieldProjectionOptions,
): FieldProjectionResult {
	if (!isRecord(value)) {
		return { projected: value, includedPaths: ['$'], omittedPaths: [], recoverable: true };
	}
	const fields = flatten(value);
	const queryTerms = tokenizeSearchText(options.query);
	const protectedPaths = new Set(options.protectedPaths ?? []);
	const always = new Set(options.alwaysIncludePaths ?? []);
	const scored = [...fields.entries()].map(([path, fieldValue], index) => {
		const searchable = `${path} ${typeof fieldValue === 'string' ? fieldValue : ''}`.toLowerCase();
		const score = queryTerms.reduce(
			(total, term) => total + (searchable.includes(term) ? 1 : 0),
			0,
		);
		const mandatory = protectedPaths.has(path) || always.has(path);
		return { path, index, score, mandatory };
	});
	const maximum = Math.max(
		protectedPaths.size + always.size,
		options.maximumFields ?? Math.min(12, fields.size),
	);
	const selected = scored
		.sort(
			(left, right) =>
				Number(right.mandatory) - Number(left.mandatory) ||
				right.score - left.score ||
				left.index - right.index,
		)
		.slice(0, maximum);
	const roots = new Set(selected.map((entry) => rootField(entry.path)));
	const projected = Object.fromEntries(Object.entries(value).filter(([key]) => roots.has(key)));
	const includedPaths = [...fields.keys()].filter((path) => roots.has(rootField(path)));
	return {
		projected,
		includedPaths,
		omittedPaths: [...fields.keys()].filter((path) => !roots.has(rootField(path))),
		recoverable: true,
	};
}
