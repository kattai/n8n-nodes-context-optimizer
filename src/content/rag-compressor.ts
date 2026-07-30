import { deduplicateUnits } from '../core/deduplicate';
import type { CompressorResult } from './types';

export function compressRag(content: string): CompressorResult {
	const chunks = content
		.replace(/\r\n?/g, '\n')
		.split(/\n{2,}/)
		.map((chunk) => chunk.trim())
		.filter(Boolean);
	return {
		content: deduplicateUnits(chunks, false).join('\n\n'),
		strategies: ['normalize-chunks', 'deduplicate-exact-chunks'],
		format: 'text',
	};
}
