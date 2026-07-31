import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { optimizeContent } = require('../dist/src/content/optimize-content.js');
const { unpackJsonV2 } = require('../dist/src/content/json-roundtrip.js');
const { estimateTokens } = require('../dist/src/core/token-estimator.js');
const {
	virtualizeMaximumSavingsToolResult,
} = require('../dist/src/model-wrapper/maximum-savings-virtualizer.js');
const { wrapLanguageModel } = require('../dist/src/model-wrapper/wrap-language-model.js');
const { resolvePreviewPolicy } = require('../dist/src/policy/preview-policy.js');
const { retrieveContext } = require('../dist/src/retrieval/retrieve-context.js');
const { FileSystemResourceStore } = require('../dist/src/storage/filesystem-store.js');
const { virtualizeContext } = require('../dist/src/virtualization/context-virtualizer.js');

const root = resolve(import.meta.dirname, '..');
const outputDirectory = join(root, 'benchmarks', 'results');
const outputJson = join(outputDirectory, 'profile-v2-results.json');
const outputMarkdown = join(outputDirectory, 'profile-v2-results.md');
const workDirectory = await mkdtemp(join(tmpdir(), 'context-saver-profile-v2-'));
const scope = 'profile-v2-benchmark';

function round(value) {
	return Number(value.toFixed(2));
}

function percent(before, after) {
	return before === 0 ? 0 : round(((before - after) / before) * 100);
}

function integrityPercent(total, failures) {
	return total === 0 ? 100 : percent(total, failures);
}

function median(values) {
	const ordered = [...values].sort((left, right) => left - right);
	const middle = Math.floor(ordered.length / 2);
	return ordered.length % 2 === 0
		? round((ordered[middle - 1] + ordered[middle]) / 2)
		: ordered[middle];
}

function reconstructJsonTable(content) {
	const lines = content.split(/\r?\n/).filter(Boolean);
	const pathLine = lines.find((line) => line.startsWith('path:'));
	const metadataLine = lines.find((line) => line.startsWith('metadata:'));
	const fieldsIndex = lines.findIndex((line) => line.startsWith('fields:'));
	const fields = JSON.parse(lines[fieldsIndex].slice('fields:'.length));
	const records = lines.slice(fieldsIndex + 1).map((line) => {
		const row = JSON.parse(line);
		return Object.fromEntries(
			fields
				.map((field, index) => [field, row[index]])
				.filter(([, value]) => !(value && value.$cs === 'missing')),
		);
	});
	if (!pathLine) return records;
	const path = JSON.parse(pathLine.slice('path:'.length));
	const metadata = metadataLine ? JSON.parse(metadataLine.slice('metadata:'.length)) : {};
	return { ...metadata, [path]: records };
}

function reconstructJson(content) {
	if (content.startsWith('@json-pack-v2\n')) return unpackJsonV2(content);
	if (content.startsWith('@json-table\n')) return reconstructJsonTable(content);
	return JSON.parse(content);
}

function buildJsonSample(variant) {
	const target = 45 + variant;
	const records = Array.from({ length: 150 }, (_, index) => ({
		id: `ORDER-${variant}-${String(index).padStart(3, '0')}`,
		status: index % 5 === 0 ? 'pending' : 'approved',
		amount: variant * 100_000 + index * 17,
		region: `region-${index % 12}`,
		approved: index % 5 !== 0,
		note: `Operational evidence batch ${variant}; preserve exact fields for audit.`,
	}));
	const value = { source: 'orders-api', variant, records };
	return {
		id: `json-${variant}`,
		type: 'json',
		content: JSON.stringify(value, null, 2),
		parsed: value,
		task: `Return the exact amount for ORDER-${variant}-${String(target).padStart(3, '0')}`,
		marker: `ORDER-${variant}-${String(target).padStart(3, '0')}`,
		retrieval: { operation: 'get_exact_value', path: `records[${target}].amount` },
		expected: records[target].amount,
	};
}

function buildRagSample(variant) {
	const target = 52 + variant;
	const duplicate =
		`Shared operating policy ${variant}. This paragraph is repeated intentionally to measure exact chunk deduplication. ` +
		'Keep the original available for evidence retrieval.';
	const sections = Array.from({ length: 120 }, (_, index) =>
		index % 4 === 0
			? duplicate
			: `Document section ${index}. Evidence RAG-${variant}-${index}; exact policy value ${variant * 10_000 + index}. ` +
				'Unique supporting context remains recoverable and must never be invented.',
	);
	sections[target] =
		`Document section ${target}. Evidence RAG-${variant}-${target}; exact policy value ${variant * 10_000 + target}. ` +
		'Unique target evidence for task-aware selection.';
	return {
		id: `rag-${variant}`,
		type: 'rag',
		content: sections.join('\n\n'),
		task: `Find exact evidence RAG-${variant}-${target}`,
		marker: `RAG-${variant}-${target}`,
		retrieval: { operation: 'get_section', section: target },
		expected: sections[target],
	};
}

function buildLogSample(variant) {
	const target = 41 + variant;
	const lines = [];
	for (let index = 0; index < 100; index++) {
		const common = `INFO batch=${variant} health-check completed`;
		lines.push(common, common);
		lines.push(
			`INFO trace=LOG-${variant}-${index} step=${index} unique operational evidence value=${variant * 1_000 + index}`,
		);
	}
	const marker = `LOG-${variant}-${target}`;
	const content = lines.join('\n');
	const start = content.indexOf(marker);
	return {
		id: `logs-${variant}`,
		type: 'logs',
		content,
		task: `Inspect exact trace ${marker}`,
		marker,
		retrieval: { operation: 'get_original_fragment', start, end: start + marker.length },
		expected: marker,
	};
}

const samples = [
	...Array.from({ length: 4 }, (_, index) => buildJsonSample(index + 1)),
	...Array.from({ length: 4 }, (_, index) => buildRagSample(index + 1)),
	...Array.from({ length: 4 }, (_, index) => buildLogSample(index + 1)),
];

function exactValueMatches(actual, expected) {
	if (typeof actual === 'string' && typeof expected === 'string') {
		return actual.trim().includes(expected.trim());
	}
	return actual === expected;
}

async function runProfileCase(profile, sample, store) {
	const structural = optimizeContent(sample.content, {
		contentType: sample.type,
		currentTask: sample.task,
		protectedValues: sample.marker,
	});
	const originalTokens = estimateTokens(sample.content);
	let optimizedContent = structural.optimizedContent;
	let resourceId;
	let retrievalRequired = false;
	let fallbackReason = structural.quality.fallbackReason ?? null;

	if (profile === 'balanced') {
		const manifest = await store.store({
			content: sample.content,
			contentType: sample.type,
			ttlSeconds: 3600,
			scope,
			recordCount: structural.manifest.recordCount,
			fields: structural.manifest.fields,
		});
		const policy = resolvePreviewPolicy(profile, estimateTokens(structural.optimizedContent));
		const virtualized = virtualizeContext(
			structural.optimizedContent,
			sample.type,
			manifest.resourceId,
			{
				thresholdTokens: 0,
				maxPreviewTokens: policy.maxPreviewTokens,
				maxItems: policy.maxItems,
				currentTask: sample.task,
				recordCount: structural.manifest.recordCount,
				fields: structural.manifest.fields,
				sourceTokens: originalTokens,
			},
		);
		if (virtualized.applied && virtualized.previewTokens < structural.tokens.optimized) {
			optimizedContent = virtualized.content;
			resourceId = manifest.resourceId;
			retrievalRequired = true;
		} else {
			await store.delete(manifest.resourceId, scope);
			fallbackReason = 'preview_not_smaller_than_structural';
		}
	}

	if (profile === 'savings') {
		const virtualized = await virtualizeMaximumSavingsToolResult({
			originalContent: sample.content,
			structural,
			currentTask: sample.task,
			options: {
				retrieverAvailable: true,
				store,
				scope,
				ttlSeconds: 3600,
				thresholdTokens: 500,
				targetPreviewRatio: 0.2,
				maxPreviewRatio: 0.3,
				allowSecretLikeContent: false,
			},
		});
		optimizedContent = virtualized.content;
		resourceId = virtualized.resourceId;
		retrievalRequired = virtualized.retrievalRequired;
		fallbackReason = virtualized.targetNotReachedReason ?? null;
	}

	let retrievalPassed = true;
	let retrievalTokens = 0;
	if (retrievalRequired && resourceId) {
		const retrieved = await retrieveContext(
			store,
			{ ...sample.retrieval, resourceId },
			{
				scope,
				maxResults: 20,
				maxTokens: 4_000,
				maxExecutionTokens: 4_000,
				allowedFields: [],
				blockedFields: [],
				allowFullOriginal: false,
			},
		);
		retrievalPassed =
			retrieved.ok && retrieved.exact && exactValueMatches(retrieved.data, sample.expected);
		retrievalTokens = retrieved.tokensEstimated ?? 0;
	}

	const optimizedTokens = estimateTokens(optimizedContent);
	const protectedRequestTokens = 600;
	const fullBefore = originalTokens + protectedRequestTokens;
	const fullAfter = optimizedTokens + protectedRequestTokens;
	const netAfter = optimizedTokens + retrievalTokens;
	let roundTripPassed = true;
	if (sample.type === 'json') {
		try {
			roundTripPassed =
				JSON.stringify(reconstructJson(structural.optimizedContent)) ===
				JSON.stringify(sample.parsed);
		} catch {
			roundTripPassed = false;
		}
	}

	return {
		profile,
		case: sample.id,
		contentType: sample.type,
		eligible: {
			before: originalTokens,
			after: optimizedTokens,
			saved: originalTokens - optimizedTokens,
			percent: percent(originalTokens, optimizedTokens),
		},
		fullRequest: {
			before: fullBefore,
			after: fullAfter,
			saved: fullBefore - fullAfter,
			percent: percent(fullBefore, fullAfter),
		},
		net: {
			before: originalTokens,
			after: netAfter,
			retrievalTokens,
			saved: originalTokens - netAfter,
			percent: percent(originalTokens, netAfter),
		},
		provider: {
			available: false,
			reason: 'Deterministic local benchmark; no paid provider call was made.',
		},
		qualityPassed: structural.quality.passed,
		inlineTargetEvidencePassed: optimizedContent.includes(sample.marker),
		roundTripPassed,
		retrievalRequired,
		retrievalPassed,
		fallbackReason,
	};
}

class RecordingModel {
	lastInput;

	async invoke(input) {
		this.lastInput = input;
		return {
			content: 'ok',
			usage_metadata: { input_tokens: estimateTokens(JSON.stringify(input)), output_tokens: 1 },
		};
	}
}

async function verifyToolIds(profile, store) {
	const callId = `call-profile-${profile}`;
	const toolContent = JSON.stringify(
		Array.from({ length: 160 }, (_, index) => ({
			id: `TOOL-${profile}-${index}`,
			status: index % 2 === 0 ? 'open' : 'closed',
			note: 'Repeated structured tool evidence for sequence validation.',
		})),
	);
	const messages = [
		{ role: 'human', content: `Find TOOL-${profile}-80` },
		{ role: 'assistant', content: '', tool_calls: [{ id: callId, name: 'list_records' }] },
		{ role: 'tool', tool_call_id: callId, content: toolContent },
		{ role: 'human', content: `Use exact record TOOL-${profile}-80` },
	];
	const model = new RecordingModel();
	const wrapped = wrapLanguageModel(model, {
		profile,
		cacheAware: { strategy: 'ignore_cache_signals' },
		...(profile === 'savings'
			? {
					maximumSavings: {
						retrieverAvailable: true,
						store,
						scope,
						ttlSeconds: 3600,
						thresholdTokens: 500,
						targetPreviewRatio: 0.2,
						maxPreviewRatio: 0.3,
						allowSecretLikeContent: false,
					},
				}
			: {}),
	});
	await wrapped.invoke(messages);
	const sent = model.lastInput;
	const call = sent.find((message) => message.tool_calls?.[0]?.id === callId);
	const result = sent.find((message) => message.tool_call_id === callId);
	return Boolean(call && result && sent.indexOf(call) < sent.indexOf(result));
}

async function writeIfChanged(path, content) {
	let existing = '';
	try {
		existing = await readFile(path, 'utf8');
	} catch {
		// The first run creates the result artifact.
	}
	if (existing !== content) await writeFile(path, content, 'utf8');
}

try {
	const store = new FileSystemResourceStore(join(workDirectory, 'resources'));
	const profiles = ['quality', 'balanced', 'savings'];
	const cases = [];
	for (const profile of profiles) {
		for (const sample of samples) cases.push(await runProfileCase(profile, sample, store));
	}
	const toolIds = Object.fromEntries(
		await Promise.all(
			profiles.map(async (profile) => [profile, await verifyToolIds(profile, store)]),
		),
	);
	const summary = Object.fromEntries(
		profiles.map((profile) => {
			const profileCases = cases.filter((entry) => entry.profile === profile);
			return [
				profile,
				{
					cases: profileCases.length,
					medianEligibleSavingsPercent: median(profileCases.map((entry) => entry.eligible.percent)),
					medianFullRequestSavingsPercent: median(
						profileCases.map((entry) => entry.fullRequest.percent),
					),
					medianNetSavingsPercent: median(profileCases.map((entry) => entry.net.percent)),
					qualityIntegrityPercent: integrityPercent(
						profileCases.length,
						profileCases.filter((entry) => !entry.qualityPassed).length,
					),
					inlineTargetEvidencePercent: integrityPercent(
						profileCases.length,
						profileCases.filter((entry) => !entry.inlineTargetEvidencePassed).length,
					),
					roundTripPercent: integrityPercent(
						profileCases.filter((entry) => entry.contentType === 'json').length,
						profileCases.filter((entry) => entry.contentType === 'json' && !entry.roundTripPassed)
							.length,
					),
					retrievalIntegrityPercent: integrityPercent(
						profileCases.filter((entry) => entry.retrievalRequired).length,
						profileCases.filter((entry) => entry.retrievalRequired && !entry.retrievalPassed)
							.length,
					),
					toolSequenceIntegrityPercent: toolIds[profile] ? 100 : 0,
				},
			];
		}),
	);

	const thresholds = { quality: 15, balanced: 35, savings: 60 };
	const passed = profiles.every(
		(profile) =>
			summary[profile].medianEligibleSavingsPercent >= thresholds[profile] &&
			summary[profile].qualityIntegrityPercent === 100 &&
			summary[profile].inlineTargetEvidencePercent === 100 &&
			summary[profile].roundTripPercent === 100 &&
			summary[profile].retrievalIntegrityPercent === 100 &&
			summary[profile].toolSequenceIntegrityPercent === 100,
	);
	const result = {
		benchmark: 'Context Saver v2 deterministic profile benchmark',
		version: '0.7.0',
		generatedFor: '2026-07-31 release',
		dataset: {
			casesPerProfile: samples.length,
			contentTypes: ['json', 'rag', 'logs'],
			providerCalls: 0,
			note: 'Percentages apply to eligible deterministic corpus, not every complete model request.',
		},
		thresholds,
		summary,
		passed,
		cases,
	};
	const json = `${JSON.stringify(result, null, 2)}\n`;
	const rows = profiles
		.map((profile) => {
			const item = summary[profile];
			return `| ${profile[0].toUpperCase()}${profile.slice(1)} | ${item.medianEligibleSavingsPercent}% | ${item.medianFullRequestSavingsPercent}% | ${item.medianNetSavingsPercent}% | ${item.qualityIntegrityPercent}% | ${item.roundTripPercent}% | ${item.retrievalIntegrityPercent}% | ${item.toolSequenceIntegrityPercent}% |`;
		})
		.join('\n');
	const markdown = `# Context Saver v2 profile benchmark\n\nStatus: **${passed ? 'PASS' : 'FAIL'}**\n\n| Profile | Eligible median | Full-request median | Net median | Quality facts | JSON round-trip | Exact retrieval | Tool IDs |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${rows}\n\n## Method\n\n- 12 deterministic cases per profile: JSON/API, RAG, and logs.\n- Eligible savings measure only content the policy may optimize.\n- Full-request savings add 600 protected tokens to show dilution by system/recent context.\n- Net savings subtract exact-retrieval tokens. No compressor model was used.\n- Provider usage is intentionally unavailable because the benchmark makes no paid LLM call.\n- Every requested marker had to remain inline; every required exact retrieval, JSON round-trip, and tool-call ID check had to pass.\n\nThese medians describe this corpus, not guaranteed savings for arbitrary workflows.\n`;
	await mkdir(outputDirectory, { recursive: true });
	await writeIfChanged(outputJson, json);
	await writeIfChanged(outputMarkdown, markdown);
	console.log(markdown);
	if (!passed) process.exitCode = 1;
} finally {
	await rm(workDirectory, { recursive: true, force: true });
}
