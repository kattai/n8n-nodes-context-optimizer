import { describe, expect, it } from 'vitest';
import { cleanJsonValue, compressJson } from '../../src/content/json-compressor';
import { packJson } from '../../src/content/json-packing';
import { jsonRoundTripMatches, unpackJsonV2 } from '../../src/content/json-roundtrip';
import { estimateTokens } from '../../src/core/token-estimator';

describe('JSON Optimizer v2', () => {
	it('round-trips nested tables, Unicode, null, empty strings and missing fields', () => {
		const original = {
			groups: [
				{
					name: 'São Paulo',
					items: [
						{ id: 1, status: null, note: '' },
						{ id: 2, note: 'ação|✓' },
					],
				},
				{
					name: 'Minas Gerais',
					items: [
						{ id: 3, active: false },
						{ id: 4, active: true },
					],
				},
			],
		};
		const packed = packJson(original);

		expect(packed.tableCount).toBeGreaterThanOrEqual(3);
		expect(jsonRoundTripMatches(original, packed.content)).toBe(true);
		expect(unpackJsonV2(packed.content)).toEqual(original);
	});

	it('escapes user objects that contain the reserved marker key', () => {
		const original = {
			rows: [
				{ id: 1, payload: { $cs: 'table', i: 999 } },
				{ id: 2, payload: { $cs: 'dict', i: 123 } },
			],
		};
		const packed = packJson(original);
		expect(unpackJsonV2(packed.content)).toEqual(original);
	});

	it('uses dictionary encoding only when it produces a net reduction', () => {
		const repeated = 'Long repeated business status that benefits from a dictionary';
		const original = {
			rows: Array.from({ length: 80 }, (_, id) => ({ id, status: repeated })),
		};
		const withDictionary = packJson(original, true);
		const withoutDictionary = packJson(original, false);
		expect(withDictionary.dictionaryApplied).toBe(true);
		expect(estimateTokens(withDictionary.content)).toBeLessThan(
			estimateTokens(withoutDictionary.content),
		);
		expect(unpackJsonV2(withDictionary.content)).toEqual(original);
	});

	it('supports include, exclude and protected JSON paths with protected precedence', () => {
		const original = {
			customer: { id: 'C-1', secret: 'remove', decision: 'KEEP' },
			metadata: { trace: 'remove' },
		};
		const cleaned = cleanJsonValue(original, {
			includeJsonPaths: ['$.customer.id', '$.customer.decision'],
			excludeJsonPaths: ['$.customer.decision', '$.metadata'],
			protectedJsonPaths: ['$.customer.decision'],
		});
		expect(cleaned).toEqual({ customer: { id: 'C-1', decision: 'KEEP' } });
	});

	it('never makes a small JSON larger', () => {
		const content = JSON.stringify({ id: 1, ok: true });
		const result = compressJson(content, {});
		expect(estimateTokens(result.content)).toBeLessThanOrEqual(estimateTokens(content));
		expect(result.format).toBe('json');
	});

	it('selects v2 packing for recursive data when it is the smallest valid representation', () => {
		const content = JSON.stringify({
			groups: Array.from({ length: 20 }, (_, group) => ({
				group,
				status: 'active expansion group with repeated descriptive status',
				items: Array.from({ length: 20 }, (_, item) => ({
					id: `${group}-${item}`,
					status: 'active expansion item with repeated descriptive status',
				})),
			})),
		});
		const result = compressJson(content, {});
		expect(result.format).toBe('json-pack-v2');
		expect(result.strategies).toContain('shared-schema-recursive');
		expect(jsonRoundTripMatches(JSON.parse(content), result.content)).toBe(true);
	});
});
