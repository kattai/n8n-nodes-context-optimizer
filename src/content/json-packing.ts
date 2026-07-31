import { dictionaryEncode } from './dictionary-encoding';

interface PackedTable {
	i: number;
	p: string;
	f: string[];
	y: string[][];
	r: unknown[][];
}

export interface JsonPackEnvelope {
	v: 2;
	r: unknown;
	t: PackedTable[];
	d?: string[];
}

export interface JsonPackResult {
	content: string;
	root: JsonPackEnvelope;
	tableCount: number;
	recordCount: number;
	fields: string[];
	dictionaryApplied: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function typeName(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	return typeof value;
}

export function packJson(value: unknown, enableDictionary = true): JsonPackResult {
	const tables: PackedTable[] = [];
	let recordCount = 0;
	const allFields = new Set<string>();

	const pack = (entry: unknown, path: string): unknown => {
		if (Array.isArray(entry)) {
			if (entry.length > 1 && entry.every(isRecord)) {
				const fields: string[] = [];
				const fieldSet = new Set<string>();
				for (const record of entry) {
					for (const field of Object.keys(record)) {
						if (fieldSet.has(field)) continue;
						fieldSet.add(field);
						fields.push(field);
						allFields.add(field);
					}
				}
				const id = tables.length;
				const table: PackedTable = { i: id, p: path, f: fields, y: [], r: [] };
				tables.push(table);
				table.r = entry.map((record, rowIndex) =>
					fields.map((field) =>
						Object.prototype.hasOwnProperty.call(record, field)
							? pack(record[field], `${path}[${rowIndex}].${field}`)
							: { $cs: 'missing' },
					),
				);
				table.y = fields.map((_, fieldIndex) => [
					...new Set(
						table.r.map((row) => {
							const fieldValue = row[fieldIndex];
							return isRecord(fieldValue) && fieldValue.$cs === 'missing'
								? 'missing'
								: typeName(fieldValue);
						}),
					),
				]);
				recordCount += entry.length;
				return { $cs: 'table', i: id };
			}
			return entry.map((item, index) => pack(item, `${path}[${index}]`));
		}
		if (!isRecord(entry)) return entry;
		const packedObject = Object.fromEntries(
			Object.entries(entry).map(([key, child]) => [key, pack(child, `${path}.${key}`)]),
		);
		return Object.prototype.hasOwnProperty.call(entry, '$cs')
			? { $cs: 'literal', v: packedObject }
			: packedObject;
	};

	const packedRoot = pack(value, '$');
	const payload = { r: packedRoot, t: tables };
	const encoded = enableDictionary
		? dictionaryEncode(payload)
		: { value: payload, dictionary: [], applied: false };
	const encodedPayload = encoded.value as { r: unknown; t: PackedTable[] };
	const envelope: JsonPackEnvelope = {
		v: 2,
		r: encodedPayload.r,
		t: encodedPayload.t,
		...(encoded.applied ? { d: encoded.dictionary } : {}),
	};
	return {
		content: `@json-pack-v2\n${JSON.stringify(envelope)}`,
		root: envelope,
		tableCount: tables.length,
		recordCount,
		fields: [...allFields],
		dictionaryApplied: encoded.applied,
	};
}
