import { dictionaryDecode } from './dictionary-encoding';
import type { JsonPackEnvelope } from './json-packing';

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function unpackJsonV2(content: string): unknown {
	const [header, ...payloadLines] = content.split(/\r?\n/);
	if (header !== '@json-pack-v2') throw new Error('Invalid JSON pack header');
	const envelope = JSON.parse(payloadLines.join('\n')) as JsonPackEnvelope;
	if (envelope.v !== 2 || !Array.isArray(envelope.t)) {
		throw new Error('Unsupported JSON pack version');
	}
	const dictionary = envelope.d ?? [];
	const decoded = dictionaryDecode({ r: envelope.r, t: envelope.t }, dictionary) as {
		r: unknown;
		t: JsonPackEnvelope['t'];
	};
	const tables = new Map(decoded.t.map((table) => [table.i, table]));

	const unpack = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(unpack);
		if (!isRecord(value)) return value;
		if (value.$cs === 'literal') {
			if (!isRecord(value.v)) return unpack(value.v);
			return Object.fromEntries(
				Object.entries(value.v).map(([key, child]) => [key, unpack(child)]),
			);
		}
		if (value.$cs === 'table' && typeof value.i === 'number') {
			const table = tables.get(value.i);
			if (!table) throw new Error(`Missing packed table ${value.i}`);
			return table.r.map((row) => {
				const record: Record<string, unknown> = {};
				for (const [fieldIndex, field] of table.f.entries()) {
					const fieldValue = row[fieldIndex];
					if (isRecord(fieldValue) && fieldValue.$cs === 'missing') continue;
					record[field] = unpack(fieldValue);
				}
				return record;
			});
		}
		return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, unpack(child)]));
	};

	return unpack(decoded.r);
}

export function jsonRoundTripMatches(original: unknown, packed: string): boolean {
	try {
		return JSON.stringify(unpackJsonV2(packed)) === JSON.stringify(original);
	} catch {
		return false;
	}
}
