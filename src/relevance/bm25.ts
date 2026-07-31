export function normalizeSearchText(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();
}

export function tokenizeSearchText(value: string): string[] {
	return normalizeSearchText(value).match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
}

export function bm25Scores(
	query: string,
	documents: string[],
	options: { k1?: number; b?: number } = {},
): number[] {
	if (documents.length === 0) return [];
	const queryTerms = [...new Set(tokenizeSearchText(query))];
	if (queryTerms.length === 0) return documents.map(() => 0);
	const tokenized = documents.map(tokenizeSearchText);
	const averageLength =
		tokenized.reduce((total, document) => total + document.length, 0) / documents.length || 1;
	const k1 = options.k1 ?? 1.2;
	const b = options.b ?? 0.75;
	const documentFrequency = new Map<string, number>();
	for (const term of queryTerms) {
		documentFrequency.set(term, tokenized.filter((document) => document.includes(term)).length);
	}
	return tokenized.map((document) => {
		const frequencies = new Map<string, number>();
		for (const term of document) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
		return queryTerms.reduce((score, term) => {
			const frequency = frequencies.get(term) ?? 0;
			if (frequency === 0) return score;
			const matches = documentFrequency.get(term) ?? 0;
			const inverseFrequency = Math.log(1 + (documents.length - matches + 0.5) / (matches + 0.5));
			const denominator = frequency + k1 * (1 - b + b * (document.length / averageLength));
			return score + inverseFrequency * ((frequency * (k1 + 1)) / denominator);
		}, 0);
	});
}
