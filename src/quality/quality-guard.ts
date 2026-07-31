import { extractProtectedFacts } from '../core/protected-facts';
import { extractProtectedBlocks } from '../content/protected-blocks';
import type { ContentManifest, ContentQuality, QualityCheck } from '../content/types';
import { unpackJsonV2 } from '../content/json-roundtrip';

function unique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}

function customValues(values: string[] | string | undefined): string[] {
	if (Array.isArray(values))
		return values
			.map(String)
			.map((value) => value.trim())
			.filter(Boolean);
	return String(values ?? '')
		.split(/\r?\n/)
		.map((value) => value.trim())
		.filter(Boolean);
}

function validJsonTable(content: string, recordCount?: number): boolean {
	const lines = content.split(/\r?\n/).filter(Boolean);
	if (lines[0] !== '@json-table') return false;
	const fieldsIndex = lines.findIndex((line) => line.startsWith('fields:'));
	if (fieldsIndex < 1) return false;
	try {
		const fields = JSON.parse(lines[fieldsIndex].slice('fields:'.length)) as unknown;
		if (!Array.isArray(fields) || !fields.every((field) => typeof field === 'string')) {
			return false;
		}
		const rows = lines.slice(fieldsIndex + 1);
		if (recordCount !== undefined && rows.length !== recordCount) return false;
		return rows.every((line) => {
			const row = JSON.parse(line) as unknown;
			return Array.isArray(row) && row.length === fields.length;
		});
	} catch {
		return false;
	}
}

export function checkContentQuality(
	original: string,
	optimized: string,
	manifest: ContentManifest,
	protectedValues?: string[] | string,
): ContentQuality {
	const checks: QualityCheck[] = [];
	const facts = unique([
		...extractProtectedFacts(original).map((fact) => fact.value),
		...customValues(protectedValues),
	]);
	const missingFacts = facts.filter((value) => !optimized.includes(value));
	checks.push({
		name: 'protected-facts',
		passed: missingFacts.length === 0,
		...(missingFacts.length > 0
			? { detail: `${missingFacts.length} protected value(s) missing` }
			: {}),
	});

	const missingBlocks = extractProtectedBlocks(original).filter(
		(block) => !optimized.includes(block.value),
	);
	checks.push({
		name: 'protected-blocks',
		passed: missingBlocks.length === 0,
		...(missingBlocks.length > 0
			? { detail: `${missingBlocks.length} protected block(s) changed` }
			: {}),
	});

	checks.push({
		name: 'non-empty',
		passed: original.trim().length === 0 || optimized.trim().length > 0,
	});

	if (manifest.format === 'json') {
		let valid = true;
		try {
			JSON.parse(optimized);
		} catch {
			valid = false;
		}
		checks.push({ name: 'valid-json', passed: valid });
	}
	if (manifest.format === 'json-table') {
		checks.push({
			name: 'reversible-json-table',
			passed: validJsonTable(optimized, manifest.recordCount),
		});
	}
	if (manifest.format === 'json-pack-v2') {
		let valid = true;
		try {
			unpackJsonV2(optimized);
		} catch {
			valid = false;
		}
		checks.push({
			name: 'reversible-json-pack-v2',
			passed: valid && manifest.roundTripVerified === true,
		});
	}

	const passedCount = checks.filter((check) => check.passed).length;
	const passed = checks.every((check) => check.passed);
	return {
		passed,
		score: checks.length === 0 ? 1 : Number((passedCount / checks.length).toFixed(2)),
		checks,
		warnings: passed ? [] : checks.filter((check) => !check.passed).map((check) => check.name),
		fallbackUsed: !passed,
		...(passed ? {} : { fallbackReason: 'quality_guard_failed' }),
	};
}
