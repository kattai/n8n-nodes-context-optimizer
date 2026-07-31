import { estimateTokens } from '../core/token-estimator';
import { bm25Scores } from './bm25';

export interface SelectableChunk {
	id: string;
	content: string;
	index: number;
	source?: string;
	protected?: boolean;
	recent?: boolean;
}

export interface RankedChunk extends SelectableChunk {
	score: number;
	reasons: string[];
}

export interface ChunkSelectionOptions {
	query: string;
	maxTokens: number;
	maxChunks: number;
	neighborWindow?: number;
	protectedBonus?: number;
	recencyBonus?: number;
	diversityBonus?: number;
}

export function rankChunks(
	chunks: SelectableChunk[],
	options: ChunkSelectionOptions,
): RankedChunk[] {
	const lexicalScores = bm25Scores(
		options.query,
		chunks.map((chunk) => chunk.content),
	);
	const bestIndexes = new Set(
		lexicalScores
			.map((score, index) => ({ score, index }))
			.sort((left, right) => right.score - left.score || left.index - right.index)
			.slice(0, Math.min(3, chunks.length))
			.map((entry) => entry.index),
	);
	const neighborWindow = Math.max(0, options.neighborWindow ?? 1);
	return chunks
		.map((chunk, chunkIndex): RankedChunk => {
			let score = lexicalScores[chunkIndex] ?? 0;
			const reasons: string[] = score > 0 ? ['bm25'] : [];
			if (chunk.protected) {
				score += options.protectedBonus ?? 1_000;
				reasons.push('protected');
			}
			if (chunk.recent) {
				score += options.recencyBonus ?? 0.25;
				reasons.push('recent');
			}
			if (
				[...bestIndexes].some(
					(bestIndex) =>
						bestIndex !== chunkIndex && Math.abs(bestIndex - chunkIndex) <= neighborWindow,
				)
			) {
				score += 0.15;
				reasons.push('neighbor');
			}
			return { ...chunk, score, reasons };
		})
		.sort((left, right) => right.score - left.score || left.index - right.index);
}

export function selectChunks(
	chunks: SelectableChunk[],
	options: ChunkSelectionOptions,
): RankedChunk[] {
	const ranked = rankChunks(chunks, options);
	const selected: RankedChunk[] = [];
	const selectedSources = new Set<string>();
	let tokens = 0;
	while (selected.length < Math.max(1, options.maxChunks)) {
		const candidates = ranked.filter(
			(candidate) => !selected.some((item) => item.id === candidate.id),
		);
		if (candidates.length === 0) break;
		candidates.sort((left, right) => {
			const leftDiversity =
				left.source && !selectedSources.has(left.source) ? (options.diversityBonus ?? 0.2) : 0;
			const rightDiversity =
				right.source && !selectedSources.has(right.source) ? (options.diversityBonus ?? 0.2) : 0;
			return (
				right.score + rightDiversity - (left.score + leftDiversity) || left.index - right.index
			);
		});
		const candidate = candidates[0];
		const candidateTokens = estimateTokens(candidate.content);
		if (tokens + candidateTokens > options.maxTokens && !candidate.protected) {
			ranked.splice(
				ranked.findIndex((item) => item.id === candidate.id),
				1,
			);
			continue;
		}
		selected.push(candidate);
		tokens += candidateTokens;
		if (candidate.source) selectedSources.add(candidate.source);
	}
	return selected.sort((left, right) => left.index - right.index);
}
