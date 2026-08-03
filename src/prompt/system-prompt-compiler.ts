import { createHash } from 'node:crypto';
import { estimateTokens } from '../core/token-estimator';
import { extractProtectedFacts } from '../core/protected-facts';

export interface PromptCompilationResult {
	content: string;
	changed: boolean;
	qualityPassed: boolean;
	tokensBefore: number;
	tokensAfter: number;
	savedTokens: number;
	removedDuplicateUnits: number;
	stableFingerprint: string;
	strategy: 'unchanged' | 'exact_deduplication';
}

const protectedBlockPattern =
	/```[\s\S]*?```|<context-saver-protected>[\s\S]*?<\/context-saver-protected>/gi;

function splitProtected(text: string): Array<{ text: string; protected: boolean }> {
	const parts: Array<{ text: string; protected: boolean }> = [];
	let cursor = 0;
	for (const match of text.matchAll(protectedBlockPattern)) {
		const index = match.index ?? 0;
		if (index > cursor) parts.push({ text: text.slice(cursor, index), protected: false });
		parts.push({ text: match[0], protected: true });
		cursor = index + match[0].length;
	}
	if (cursor < text.length) parts.push({ text: text.slice(cursor), protected: false });
	return parts;
}

function unitKey(value: string): string {
	return value
		.trim()
		.replace(/[ \t]+/g, ' ')
		.replace(/\r\n/g, '\n');
}

function deduplicatePlainText(text: string, seen: Set<string>): { text: string; removed: number } {
	const units = text.split(/(?:\r?\n){2,}/);
	const kept: string[] = [];
	let removed = 0;
	for (const unit of units) {
		const key = unitKey(unit);
		if (!key) continue;
		if (seen.has(key)) {
			removed++;
			continue;
		}
		seen.add(key);
		kept.push(unit.trim());
	}
	return { text: kept.join('\n\n'), removed };
}

function factsPreserved(before: string, after: string): boolean {
	const facts = extractProtectedFacts(before);
	return facts.every((fact) => after.includes(fact.value));
}

function fingerprint(text: string): string {
	return createHash('sha256').update(text).digest('hex');
}

export function compileSystemPrompt(
	text: string,
	minimumNetSavingsTokens = 1,
): PromptCompilationResult {
	const tokensBefore = estimateTokens(text);
	const seen = new Set<string>();
	let removedDuplicateUnits = 0;
	const compiledParts = splitProtected(text).map((part) => {
		if (part.protected) return part.text;
		const compiled = deduplicatePlainText(part.text, seen);
		removedDuplicateUnits += compiled.removed;
		return compiled.text;
	});
	const candidate = compiledParts.filter(Boolean).join('\n\n').trim();
	const tokensAfter = estimateTokens(candidate);
	const savedTokens = tokensBefore - tokensAfter;
	const qualityPassed = Boolean(candidate) && factsPreserved(text, candidate);
	const accepted = qualityPassed && savedTokens >= Math.max(1, minimumNetSavingsTokens);
	const content = accepted ? candidate : text;

	return {
		content,
		changed: accepted,
		qualityPassed,
		tokensBefore,
		tokensAfter: accepted ? tokensAfter : tokensBefore,
		savedTokens: accepted ? savedTokens : 0,
		removedDuplicateUnits: accepted ? removedDuplicateUnits : 0,
		stableFingerprint: fingerprint(content),
		strategy: accepted ? 'exact_deduplication' : 'unchanged',
	};
}
