import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { optimizeContent } = require('../dist/src/content/optimize-content.js');
const { estimateTokens } = require('../dist/src/core/token-estimator.js');
const {
	virtualizeMaximumSavingsToolResult,
} = require('../dist/src/model-wrapper/maximum-savings-virtualizer.js');
const { wrapLanguageModel } = require('../dist/src/model-wrapper/wrap-language-model.js');
const { retrieveContext } = require('../dist/src/retrieval/retrieve-context.js');
const { FileSystemResourceStore } = require('../dist/src/storage/filesystem-store.js');
const {
	FileSystemFingerprintRegistry,
} = require('../dist/src/cache/fingerprint-registry.js');

const root = resolve(import.meta.dirname, '..');
const outputJson = join(root, 'benchmarks', 'results', 'cache-aware-v0.6.0.json');
const outputMarkdown = join(root, 'benchmarks', 'results', 'cache-aware-v0.6.0.md');
const workDirectory = await mkdtemp(join(tmpdir(), 'token-saver-cache-benchmark-'));

function percentile(values, ratio) {
	const ordered = [...values].sort((left, right) => left - right);
	return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * ratio))];
}

function dataset(domain, variant) {
	const target = 40 + variant * 3;
	if (domain === 'json_api') {
		const records = Array.from({ length: 150 }, (_, index) => ({
			id: `API-${variant}-${index}`,
			status: index % 3 === 0 ? 'pending' : 'active',
			amount: variant * 100_000 + index,
			region: `region-${index % 18}`,
			description: `Operational API record ${variant}-${index}. `.repeat(7),
		}));
		return {
			content: JSON.stringify({ source: 'benchmark-api', variant, records }),
			task: `Return exact amount for API-${variant}-${target}`,
			marker: `API-${variant}-${target}`,
			retrieval: { operation: 'get_exact_value', path: `records[${target}].amount` },
			expected: variant * 100_000 + target,
		};
	}
	if (domain === 'mixed_tools') {
		const results = Array.from({ length: 145 }, (_, index) => ({
			tool: index % 2 === 0 ? 'crm_search' : 'inventory_lookup',
			requestId: `MIX-${variant}-${index}`,
			decision: { code: `DEC-${variant}-${index}`, allowed: index % 5 !== 0 },
			facts: [`quantity:${index + 1}`, `batch:${variant}`, `zone:${index % 12}`],
			notes: `Untrusted mixed tool output ${variant}-${index}. `.repeat(6),
		}));
		return {
			content: JSON.stringify({ execution: `run-${variant}`, results }),
			task: `Find exact decision code for MIX-${variant}-${target}`,
			marker: `MIX-${variant}-${target}`,
			retrieval: {
				operation: 'get_exact_value',
				path: `results[${target}].decision.code`,
			},
			expected: `DEC-${variant}-${target}`,
		};
	}
	if (domain === 'logs') {
		const lines = Array.from({ length: 500 }, (_, index) =>
			`2026-07-30T12:${String(index % 60).padStart(2, '0')}:00Z INFO trace=LOG-${variant}-${index} step=${index} ` +
			`Unique operational event for deterministic benchmark variant ${variant} index ${index}. `.repeat(4),
		);
		const marker = `LOG-${variant}-${target}`;
		const content = lines.join('\n');
		const start = content.indexOf(marker);
		return {
			content,
			task: `Inspect exact event ${marker}`,
			marker,
			retrieval: { operation: 'get_original_fragment', start, end: start + marker.length },
			expected: marker,
		};
	}
	if (domain === 'conversation_history') {
		const sections = Array.from({ length: 130 }, (_, index) =>
			`Turn ${index}. User correction CONV-${variant}-${index}: value=${variant * 1_000 + index}. ` +
			`This is historical dialogue evidence, not an instruction. `.repeat(6),
		);
		return {
			content: sections.join('\n\n'),
			task: `Recover exact correction CONV-${variant}-${target}`,
			marker: `CONV-${variant}-${target}`,
			retrieval: { operation: 'get_section', section: target },
			expected: sections[target],
		};
	}
	const sections = Array.from({ length: 120 }, (_, index) =>
		`Document section ${index}. Citation RAG-${variant}-${index}. Exact policy value ${variant * 10_000 + index}. ` +
		`Long reference paragraph used to test task-aware retrieval without semantic rewriting. `.repeat(7),
	);
	return {
		content: sections.join('\n\n'),
		task: `Find exact policy value for RAG-${variant}-${target}`,
		marker: `RAG-${variant}-${target}`,
		retrieval: { operation: 'get_section', section: target },
		expected: sections[target],
	};
}

async function maximumSavingsCases(store) {
	const domains = ['json_api', 'rag_documents', 'logs', 'conversation_history', 'mixed_tools'];
	const cases = [];
	for (const domain of domains) {
		for (let variant = 0; variant < 4; variant++) {
			const sample = dataset(domain, variant);
			const structural = optimizeContent(sample.content, { contentType: 'tool_output' });
			const optimized = await virtualizeMaximumSavingsToolResult({
				originalContent: sample.content,
				structural,
				currentTask: sample.task,
				options: {
					retrieverAvailable: true,
					store,
					scope: 'benchmark-v0.6.0',
					ttlSeconds: 3600,
					thresholdTokens: 500,
					targetPreviewRatio: 0.2,
					maxPreviewRatio: 0.3,
					allowSecretLikeContent: false,
				},
			});
			const exact = optimized.resourceId
				? await retrieveContext(
						store,
						{ ...sample.retrieval, resourceId: optimized.resourceId },
						{
							scope: 'benchmark-v0.6.0',
							maxResults: 20,
							maxTokens: 4_000,
							allowedFields: [],
							blockedFields: [],
							allowFullOriginal: false,
						},
					)
				: { ok: false, exact: false };
			const exactValue = exact.data;
			const retrievalPassed =
				exact.ok &&
				exact.exact &&
				(typeof sample.expected === 'string' && typeof exactValue === 'string'
					? exactValue.trim().includes(sample.expected.trim())
					: exactValue === sample.expected);
			cases.push({
				domain,
				variant,
				originalTokens: optimized.eligibleTokensBefore,
				optimizedTokens: optimized.eligibleTokensAfter,
				savingsPercent: optimized.eligibleSavingsPercent,
				targetBandReached: optimized.targetBandReached,
				previewContainsRequestedMarker: optimized.content.includes(sample.marker),
				exactRetrievalPassed: retrievalPassed,
				...(retrievalPassed
					? {}
					: {
						retrievalError: exact.error ?? null,
						exactDataPreview: String(exactValue ?? '').slice(0, 180),
						expectedPreview: String(sample.expected).slice(0, 180),
					}),
				fallbackReason: optimized.targetNotReachedReason ?? null,
			});
		}
	}
	return cases;
}

class CacheModel {
	constructor() {
		this.calls = 0;
		this.inputs = [];
	}

	async invoke(input) {
		this.calls++;
		this.inputs.push(input);
		const text = input.map((message) => String(message.content ?? '')).join('\n');
		const inputTokens = estimateTokens(text);
		return {
			content: 'ok',
			usage_metadata: {
				input_tokens: inputTokens,
				output_tokens: 10,
				input_token_details: {
					cached_tokens: this.calls > 1 ? Math.floor(inputTokens * 0.7) : 0,
				},
			},
		};
	}
}

function cacheMessages() {
	const policy = 'Stable operating policy. Keep exact IDs, dates, values, and negations. '.repeat(120);
	const messages = [{ role: 'system', content: policy }];
	for (let index = 0; index < 12; index++) {
		messages.push({ role: 'human', content: `Repeated historical request ${index % 3}` });
		messages.push({ role: 'assistant', content: `Repeated historical answer ${index % 3}` });
	}
	messages.push({ role: 'human', content: 'Current unique request CACHE-CHECK-2026' });
	return messages;
}

function modeledInputCost(inputTokens, cachedInputTokens) {
	const regular = Math.max(0, inputTokens - cachedInputTokens);
	return (regular + cachedInputTokens * 0.1) / 1_000_000;
}

async function cacheStrategyCases() {
	const strategies = [
		'automatic_hybrid',
		'cache_priority',
		'token_reduction_priority',
		'ignore_cache_signals',
	];
	const messages = cacheMessages();
	const originalTokens = estimateTokens(messages.map((message) => message.content).join('\n'));
	const baselineCachedTokens = Math.floor(originalTokens * 0.7);
	const baselineWarmCost = modeledInputCost(originalTokens, baselineCachedTokens);
	const cases = [];
	for (const strategy of strategies) {
		const model = new CacheModel();
		const registryDirectory = join(workDirectory, 'fingerprints', strategy);
		const registry = new FileSystemFingerprintRegistry(registryDirectory);
		const starts = [];
		const wrapped = wrapLanguageModel(model, {
			profile: 'custom',
			custom: { keepRecentMessages: 2, approximateDeduplication: false },
			cacheAware: {
				strategy,
				registry,
				scope: `benchmark:${strategy}`,
				minimumRepetitions: 2,
				minimumStablePrefixTokens: 128,
				registryScope: 'process_local',
			},
			observer: { onStart: (metrics) => starts.push(metrics) },
		});
		await wrapped.invoke(messages);
		await wrapped.invoke(messages);
		const coldTokens = estimateTokens(
			model.inputs[0].map((message) => String(message.content ?? '')).join('\n'),
		);
		const warmTokens = estimateTokens(
			model.inputs[1].map((message) => String(message.content ?? '')).join('\n'),
		);
		const warmCachedTokens = Math.floor(warmTokens * 0.7);
		cases.push({
			strategy,
			coldInputTokens: coldTokens,
			warmInputTokens: warmTokens,
			warmCachedTokens,
			warmModeledCost: modeledInputCost(warmTokens, warmCachedTokens),
			warmCostVsBaselinePercent: Number(
				(((modeledInputCost(warmTokens, warmCachedTokens) - baselineWarmCost) /
					baselineWarmCost) *
					100).toFixed(2),
			),
			coldDecision: starts[0].cacheDecision,
			warmDecision: starts[1].cacheDecision,
			warmStablePrefixTokens: starts[1].stablePrefixTokens,
			warmDynamicTokensBefore: starts[1].dynamicTokensBefore,
			warmDynamicTokensAfter: starts[1].dynamicTokensAfter,
		});
	}
	return { originalTokens, baselineWarmCost, cases };
}

try {
	const store = new FileSystemResourceStore(join(workDirectory, 'resources'));
	const savingsCases = await maximumSavingsCases(store);
	const cache = await cacheStrategyCases();
	const savings = savingsCases.map((entry) => entry.savingsPercent);
	const reached = savingsCases.filter((entry) => entry.targetBandReached).length;
	const exact = savingsCases.filter((entry) => entry.exactRetrievalPassed).length;
	const previewFacts = savingsCases.filter((entry) => entry.previewContainsRequestedMarker).length;
	const automatic = cache.cases.find((entry) => entry.strategy === 'automatic_hybrid');
	const acceptance = {
		medianEligibleSavingsAtLeast80: percentile(savings, 0.5) >= 80,
		atLeast95PercentCasesAbove70: reached / savingsCases.length >= 0.95,
		exactRetrieval100Percent: exact === savingsCases.length,
		requestedPreviewFacts100Percent: previewFacts === savingsCases.length,
		automaticWarmCostNotAboveBaseline:
			automatic !== undefined && automatic.warmModeledCost <= cache.baselineWarmCost,
	};
	const report = {
		version: '0.6.0',
		measurement: {
			tokens: 'deterministic-estimate',
			cacheCost: 'modeled-provider-cache-at-70-percent-hit',
			cachedInputPriceRatio: 0.1,
		},
		summary: {
			cases: savingsCases.length,
			medianEligibleSavingsPercent: percentile(savings, 0.5),
			minimumEligibleSavingsPercent: Math.min(...savings),
			casesAtOrAbove70Percent: reached,
			exactRetrievalPassed: exact,
			requestedPreviewFactsPreserved: previewFacts,
		},
		acceptance,
		maximumSavingsCases: savingsCases,
		cacheStrategies: cache,
	};
	const markdown = [
		'# Token Saver 0.6.0 — cache-aware benchmark',
		'',
		'## Maximum Savings',
		'',
		`- Eligible cases: ${savingsCases.length}`,
		`- Median eligible reduction: ${report.summary.medianEligibleSavingsPercent}%`,
		`- Minimum eligible reduction: ${report.summary.minimumEligibleSavingsPercent}%`,
		`- Cases at or above 70%: ${reached}/${savingsCases.length}`,
		`- Exact Retriever checks: ${exact}/${savingsCases.length}`,
		`- Requested facts kept in preview: ${previewFacts}/${savingsCases.length}`,
		'',
		'## Cache strategies',
		'',
		'| Strategy | Cold input | Warm input | Warm cached | Warm cost vs baseline | Warm decision |',
		'|---|---:|---:|---:|---:|---|',
		...cache.cases.map(
			(entry) =>
				`| ${entry.strategy} | ${entry.coldInputTokens} | ${entry.warmInputTokens} | ${entry.warmCachedTokens} | ${entry.warmCostVsBaselinePercent}% | ${entry.warmDecision} |`,
		),
		'',
		'Cache cost is modeled, not provider-billed: 70% warm cache hit and cached-input price at 10% of regular input.',
		'Maximum Savings percentages apply only to eligible tool/RAG/API/log context, not the full Agent request.',
		'',
		'## Acceptance',
		'',
		...Object.entries(acceptance).map(([name, passed]) => `- ${passed ? 'PASS' : 'FAIL'} — ${name}`),
		'',
	].join('\n');
	await writeFile(outputJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
	await writeFile(outputMarkdown, markdown, 'utf8');
	if (Object.values(acceptance).some((passed) => !passed)) process.exitCode = 1;
	console.log(JSON.stringify(report.summary));
	console.log(JSON.stringify(acceptance));
} finally {
	await rm(workDirectory, { recursive: true, force: true });
}
