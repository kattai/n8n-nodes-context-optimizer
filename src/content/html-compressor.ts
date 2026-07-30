import type { CompressorResult } from './types';

function decodeEntities(value: string): string {
	return value
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'");
}

export function compressHtml(content: string): CompressorResult {
	const text = decodeEntities(
		removeHtmlBoilerplate(content)
			.replace(
				/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
				(_, href: string, label: string) => `${label.replace(/<[^>]+>/g, '')} (${href})`,
			)
			.replace(/<\/?(?:p|div|section|article|main|header|h[1-6]|tr|li|br)\b[^>]*>/gi, '\n')
			.replace(/<\/?(?:td|th)\b[^>]*>/gi, ' | ')
			.replace(/<[^>]+>/g, ' '),
	)
		.replace(/[ \t]+/g, ' ')
		.replace(/\s*\n\s*/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return {
		content: text,
		strategies: ['remove-html-boilerplate', 'extract-visible-text', 'preserve-links'],
		format: 'html-text',
	};
}

export function removeHtmlBoilerplate(content: string): string {
	return content
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<(script|style|nav|footer|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
}
