import type { ContentType, DetectedContentType } from './types';

function isJson(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
	try {
		JSON.parse(trimmed);
		return true;
	} catch {
		return false;
	}
}

function looksLikeLogs(value: string): boolean {
	const lines = value.split(/\r?\n/).filter((line) => line.trim().length > 0);
	if (lines.length < 2) return false;
	const matches = lines.filter((line) =>
		/^(?:\d{4}-\d{2}-\d{2}[T\s][\d:.+-]+\s+)?(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\b/i.test(
			line.trim(),
		),
	);
	return matches.length / lines.length >= 0.4;
}

function looksLikeCode(value: string): boolean {
	return (
		/\b(?:function|class|interface|const|let|var|import|export|def|async|SELECT|INSERT|UPDATE|CREATE TABLE)\b/.test(
			value,
		) &&
		/[{}();]|:\s*(?:string|number|boolean)\b/.test(value)
	);
}

export function detectContentType(
	content: string,
	hint: ContentType = 'auto',
): DetectedContentType {
	if (hint !== 'auto') return hint;
	const trimmed = content.trim();
	if (isJson(trimmed)) return 'json';
	if (/<!doctype\s+html|<(?:html|body|main|article|table|div|p)(?:\s|>)/i.test(trimmed)) {
		return 'html';
	}
	if (looksLikeLogs(trimmed)) return 'logs';
	if (looksLikeCode(trimmed)) return 'code';
	return 'text';
}
