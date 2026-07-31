import { countTokens } from '../tokens/token-counter';
import type { TokenCountOptions } from '../tokens/types';

export function estimateTokens(text: string, options: TokenCountOptions = {}): number {
	return countTokens(text, options).tokens;
}

export function estimateSections(sections: string[]): number {
	return sections.reduce((total, section) => total + estimateTokens(section), 0);
}
