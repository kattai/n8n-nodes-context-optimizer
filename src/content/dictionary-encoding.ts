import { estimateTokens } from '../core/token-estimator';

export interface DictionaryEncoded {
	value: unknown;
	dictionary: string[];
	applied: boolean;
}

function collectStrings(value: unknown, counts: Map<string, number>): void {
	if (typeof value === 'string') {
		counts.set(value, (counts.get(value) ?? 0) + 1);
		return;
	}
	if (Array.isArray(value)) {
		for (const entry of value) collectStrings(entry, counts);
		return;
	}
	if (!value || typeof value !== 'object') return;
	for (const entry of Object.values(value as Record<string, unknown>)) {
		collectStrings(entry, counts);
	}
}

function replaceStrings(value: unknown, dictionary: Map<string, number>): unknown {
	if (typeof value === 'string') {
		const index = dictionary.get(value);
		return index === undefined ? value : { $cs: 'dict', i: index };
	}
	if (Array.isArray(value)) return value.map((entry) => replaceStrings(entry, dictionary));
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
			key,
			key === '$cs' ? entry : replaceStrings(entry, dictionary),
		]),
	);
}

export function dictionaryEncode(value: unknown): DictionaryEncoded {
	const counts = new Map<string, number>();
	collectStrings(value, counts);
	const candidates = [...counts.entries()]
		.filter(([text, count]) => count >= 3 && text.length >= 8)
		.sort((left, right) => right[0].length * right[1] - left[0].length * left[1])
		.map(([text]) => text);
	if (candidates.length === 0) return { value, dictionary: [], applied: false };

	const index = new Map(candidates.map((text, candidateIndex) => [text, candidateIndex]));
	const encoded = replaceStrings(value, index);
	const originalTokens = estimateTokens(JSON.stringify(value));
	const encodedTokens = estimateTokens(JSON.stringify({ d: candidates, v: encoded }));
	if (encodedTokens >= originalTokens) return { value, dictionary: [], applied: false };
	return { value: encoded, dictionary: candidates, applied: true };
}

export function dictionaryDecode(value: unknown, dictionary: string[]): unknown {
	if (Array.isArray(value)) return value.map((entry) => dictionaryDecode(entry, dictionary));
	if (!value || typeof value !== 'object') return value;
	const record = value as Record<string, unknown>;
	if (record.$cs === 'literal' && record.v && typeof record.v === 'object') {
		const literal = record.v as Record<string, unknown>;
		return {
			$cs: 'literal',
			v: Object.fromEntries(
				Object.entries(literal).map(([key, entry]) => [
					key,
					key === '$cs' ? entry : dictionaryDecode(entry, dictionary),
				]),
			),
		};
	}
	if (record.$cs === 'dict' && typeof record.i === 'number') {
		return dictionary[record.i];
	}
	return Object.fromEntries(
		Object.entries(record).map(([key, entry]) => [key, dictionaryDecode(entry, dictionary)]),
	);
}
