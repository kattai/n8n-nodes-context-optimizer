import { deduplicateUnits } from '../core/deduplicate';
import { protectBlocks } from './protected-blocks';
import type { CompressorResult } from './types';

export function compressText(content: string): CompressorResult {
	const protectedContent = protectBlocks(content);
	const normalized = protectedContent.content
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.trimEnd())
		.join('\n')
		.replace(/^\s*[-=_]{3,}\s*$/gm, '')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	const paragraphs = normalized.split(/\n{2,}/).map((entry) => entry.trim()).filter(Boolean);
	const deduplicated = deduplicateUnits(paragraphs, false).join('\n\n');
	return {
		content: protectedContent.restore(deduplicated),
		strategies: ['normalize-text', 'remove-decorative-markdown', 'deduplicate-exact'],
		format: 'text',
	};
}
