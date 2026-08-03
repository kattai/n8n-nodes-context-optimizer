import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { optimizeContent } from '../../src/content/optimize-content';
import { virtualizeMaximumSavingsToolResult } from '../../src/model-wrapper/maximum-savings-virtualizer';
import { FileSystemResourceStore } from '../../src/storage/filesystem-store';
import type { ResourceStore } from '../../src/storage/types';

const directories: string[] = [];

async function temporaryStore(): Promise<FileSystemResourceStore> {
	const directory = await mkdtemp(join(tmpdir(), 'maximum-savings-'));
	directories.push(directory);
	return new FileSystemResourceStore(directory);
}

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map(
				async (directory) =>
					await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
			),
	);
});

function options(store: ResourceStore) {
	return {
		retrieverAvailable: true,
		store,
		scope: 'workflow-test',
		ttlSeconds: 3600,
		thresholdTokens: 500,
		targetPreviewRatio: 0.2,
		maxPreviewRatio: 0.3,
		allowSecretLikeContent: false,
	};
}

describe('Maximum Savings virtualizer', () => {
	it('reaches at least 70% savings in at least 95% of structured cases', async () => {
		const store = await temporaryStore();
		let reached = 0;
		for (let dataset = 0; dataset < 20; dataset++) {
			const content = JSON.stringify({
				dataset,
				records: Array.from({ length: 100 + dataset * 5 }, (_, index) => ({
					id: `DATA-${dataset}-${index}`,
					status: index % 4 === 0 ? 'pending' : 'active',
					amount: dataset * 10_000 + index,
					city: `City ${index % 30}`,
					description: `Operational context ${dataset} `.repeat(8 + (index % 3)),
				})),
			});
			const structural = optimizeContent(content, { contentType: 'tool_output' });
			const result = await virtualizeMaximumSavingsToolResult({
				originalContent: content,
				structural,
				currentTask: `Find DATA-${dataset}-${80 + dataset}`,
				options: options(store),
			});
			if (result.targetBandReached) reached++;
			expect(result.eligibleTokensAfter).toBeLessThanOrEqual(result.eligibleTokensBefore * 0.3);
			expect(result.retrievalRequired).toBe(true);
		}
		expect(reached).toBeGreaterThanOrEqual(19);
	}, 20_000);

	it('falls back to structural content when storage fails', async () => {
		const content = Array.from(
			{ length: 150 },
			(_, index) =>
				`Unique operational section ${index}: marker-${index} ${'detailed evidence '.repeat(10)}`,
		).join('\n\n');
		const structural = optimizeContent(content, { contentType: 'tool_output' });
		const failingStore: ResourceStore = {
			store: async () => {
				throw new Error('disk unavailable');
			},
			inspect: async () => {
				throw new Error('not used');
			},
			read: async () => {
				throw new Error('not used');
			},
			delete: async () => false,
			purgeExpired: async () => 0,
		};

		const result = await virtualizeMaximumSavingsToolResult({
			originalContent: content,
			structural,
			currentTask: 'Find record 120',
			options: options(failingStore),
		});

		expect(result.content).toBe(structural.optimizedContent);
		expect(result).toMatchObject({
			retrievalRequired: false,
			storageFallbackUsed: true,
			targetNotReachedReason: 'storage_error',
		});
	});

	it('does not virtualize code-like tool output', async () => {
		const store = await temporaryStore();
		const content = `export function calculateInvoice(value: number) {\n${'  return value * 1.2;\n'.repeat(400)}}`;
		const structural = optimizeContent(content, { contentType: 'tool_output' });

		const result = await virtualizeMaximumSavingsToolResult({
			originalContent: content,
			structural,
			currentTask: 'Review calculateInvoice',
			options: options(store),
		});

		expect(result.retrievalRequired).toBe(false);
		expect(result.targetNotReachedReason).toBe('content_type_not_eligible');
	});
});
