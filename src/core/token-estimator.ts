export function estimateTokens(text: string): number {
	if (!text) return 0;
	const words = text.match(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
	const characterEstimate = Math.ceil(text.length / 4);
	const lexicalEstimate = Math.ceil(words.length * 1.15);
	return Math.max(1, Math.round((characterEstimate + lexicalEstimate) / 2));
}

export function estimateSections(sections: string[]): number {
	return sections.reduce((total, section) => total + estimateTokens(section), 0);
}
