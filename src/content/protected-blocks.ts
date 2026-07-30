import { createHash } from 'node:crypto';

const protectedBlockPattern =
	/<context-optimizer-protected>[\s\S]*?<\/context-optimizer-protected>/gi;

export interface ProtectedBlock {
	value: string;
	hash: string;
}

export function extractProtectedBlocks(content: string): ProtectedBlock[] {
	return [...content.matchAll(protectedBlockPattern)].map((match) => ({
		value: match[0],
		hash: createHash('sha256').update(match[0]).digest('hex'),
	}));
}

export function protectBlocks(content: string): {
	content: string;
	restore: (optimized: string) => string;
} {
	const blocks: string[] = [];
	const protectedContent = content.replace(protectedBlockPattern, (block) => {
		const index = blocks.push(block) - 1;
		return `CONTEXT_OPTIMIZER_PROTECTED_BLOCK_${index}`;
	});
	return {
		content: protectedContent,
		restore: (optimized) =>
			optimized.replace(
				/CONTEXT_OPTIMIZER_PROTECTED_BLOCK_(\d+)/g,
				(_, rawIndex: string) => blocks[Number(rawIndex)] ?? '',
			),
	};
}
