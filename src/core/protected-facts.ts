import type { ProtectedFact } from './types';

const patterns: Array<{ type: ProtectedFact['type']; regex: RegExp }> = [
	{ type: 'email', regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu },
	{ type: 'url', regex: /\bhttps?:\/\/[^\s<>"')\]]+/giu },
	{ type: 'money', regex: /(?:R\$|US\$|USD|BRL|EUR|€|£|\$)\s*\d[\d.,]*/giu },
	{ type: 'date', regex: /\b(?:\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\b/gu },
	{ type: 'time', regex: /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/gu },
	{ type: 'id', regex: /\b(?=[A-Z0-9_-]{4,}\b)(?=[A-Z0-9_-]*[A-Z])(?=[A-Z0-9_-]*\d)[A-Z0-9_-]+\b/gu },
	{ type: 'number', regex: /\b\d+(?:[.,]\d+)?%?\b/gu },
	{ type: 'boolean', regex: /\b(?:true|false)\b/giu },
];

function uniqueFacts(facts: ProtectedFact[]): ProtectedFact[] {
	const seen = new Set<string>();
	return facts.filter((fact) => {
		const key = `${fact.type}:${fact.value}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export function extractProtectedFacts(
	text: string,
	customValues: string[] = [],
): ProtectedFact[] {
	const facts: ProtectedFact[] = [];

	for (const { type, regex } of patterns) {
		for (const match of text.matchAll(regex)) {
			if (match[0]) facts.push({ type, value: match[0] });
		}
	}

	for (const value of customValues.map((entry) => entry.trim()).filter(Boolean)) {
		facts.push({ type: 'custom', value });
	}

	return uniqueFacts(facts);
}

export function validateProtectedFacts(
	facts: ProtectedFact[],
	candidate: string,
): { valid: boolean; missing: string[] } {
	const missing = [...new Set(facts.map((fact) => fact.value))].filter(
		(value) => !candidate.includes(value),
	);
	return { valid: missing.length === 0, missing };
}
