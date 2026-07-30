import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCacheFingerprint } from '../../src/cache/fingerprint';
import { FileSystemFingerprintRegistry } from '../../src/cache/fingerprint-registry';
import { wrapLanguageModel } from '../../src/model-wrapper/wrap-language-model';

const directories: string[] = [];

async function registry(): Promise<FileSystemFingerprintRegistry> {
	const directory = await mkdtemp(join(tmpdir(), 'cache-aware-wrapper-'));
	directories.push(directory);
	return new FileSystemFingerprintRegistry(directory);
}

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

class CacheReportingModel {
	lastInput: unknown;

	async invoke(input: unknown) {
		this.lastInput = input;
		return {
			content: 'ok',
			usage_metadata: {
				input_tokens: 5_000,
				output_tokens: 20,
				input_token_details: { cached_tokens: 2_400 },
			},
		};
	}
}

function cacheAware(
	registryInstance: FileSystemFingerprintRegistry,
	strategy:
		| 'automatic_hybrid'
		| 'cache_priority'
		| 'token_reduction_priority'
		| 'ignore_cache_signals',
) {
	return {
		strategy,
		registry: registryInstance,
		scope: 'workflow:node:model',
		minimumRepetitions: 2,
		minimumStablePrefixTokens: 1,
	};
}

describe('cache-aware language model wrapper', () => {
	it('preserves uncertain and then repeated prefix messages in automatic hybrid mode', async () => {
		const model = new CacheReportingModel();
		const fingerprints = await registry();
		const messages = [
			{ role: 'human', content: 'duplicated old fact' },
			{ role: 'assistant', content: 'same old answer' },
			{ role: 'human', content: 'duplicated old fact' },
			{ role: 'assistant', content: 'same old answer' },
			{ role: 'human', content: 'recent question' },
			{ role: 'assistant', content: 'recent answer' },
		];
		const wrapped = wrapLanguageModel(model, {
			profile: 'custom',
			custom: { keepRecentMessages: 2, approximateDeduplication: false },
			cacheAware: cacheAware(fingerprints, 'automatic_hybrid'),
		});

		await wrapped.invoke(messages);
		expect(model.lastInput).toEqual(messages);
		await wrapped.invoke(messages);
		expect(model.lastInput).toEqual(messages);
	});

	it('removes old duplicates when direct token reduction has priority', async () => {
		const model = new CacheReportingModel();
		const messages = [
			{ role: 'human', content: 'duplicated old fact' },
			{ role: 'assistant', content: 'same old answer' },
			{ role: 'human', content: 'duplicated old fact' },
			{ role: 'assistant', content: 'same old answer' },
			{ role: 'human', content: 'recent question' },
			{ role: 'assistant', content: 'recent answer' },
		];
		const wrapped = wrapLanguageModel(model, {
			profile: 'custom',
			custom: { keepRecentMessages: 2, approximateDeduplication: false },
			cacheAware: cacheAware(await registry(), 'token_reduction_priority'),
		});

		await wrapped.invoke(messages);

		expect((model.lastInput as unknown[]).length).toBeLessThan(messages.length);
		expect((model.lastInput as unknown[]).slice(-2)).toEqual(messages.slice(-2));
	});

	it('stores provider cache evidence only as fingerprint metadata', async () => {
		const model = new CacheReportingModel();
		const fingerprints = await registry();
		const content = 'A stable system prompt long enough to be worth caching.';
		const wrapped = wrapLanguageModel(model, {
			profile: 'balanced',
			cacheAware: cacheAware(fingerprints, 'automatic_hybrid'),
		});

		await wrapped.invoke([
			{ role: 'system', content },
			{ role: 'human', content: 'current request' },
		]);

		const fingerprint = createCacheFingerprint({
			scope: 'workflow:node:model',
			position: 'messages[0].content',
			content,
		});
		expect(await fingerprints.get(fingerprint)).toMatchObject({
			seenCount: 1,
			lastProviderCachedTokens: 2_400,
		});
	});
});
