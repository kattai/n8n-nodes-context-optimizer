import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { optimizeContext } = require('../dist/src/core/optimizer.js');
const { checkContentQuality } = require('../dist/src/quality/quality-guard.js');

const root = resolve(import.meta.dirname, '..');
const outputDirectory = join(root, 'benchmarks', 'results');
const outputJson = join(outputDirectory, 'semantic-quality-v0.9.0.json');
const outputMarkdown = join(outputDirectory, 'semantic-quality-v0.9.0.md');

function manifest(original, optimized) {
	return {
		contentType: 'text',
		originalHash: '',
		originalBytes: Buffer.byteLength(original),
		optimizedBytes: Buffer.byteLength(optimized),
		format: 'text',
	};
}

async function writeIfChanged(path, content) {
	let existing = '';
	try {
		existing = await readFile(path, 'utf8');
	} catch {
		// First run creates the artifact.
	}
	if (existing !== content) await writeFile(path, content, 'utf8');
}

const semanticHistory = [
	...Array.from({ length: 24 }, (_, index) => {
		const group = String.fromCharCode(65 + Math.floor(index / 2));
		return index % 2 === 0
			? `Account group ${group} approved delivery after document review. `.repeat(8)
			: `Delivery approval for account group ${group} followed document review. `.repeat(8);
	}),
	'Latest correction: account ACCT-991 remains pending for 31/07/2026.',
].join('\n');
let semanticCalls = 0;
const semantic = await optimizeContext(
	{ conversationHistory: semanticHistory, currentMessage: 'Summarize delivery approvals.' },
	{
		profile: 'custom',
		custom: { keepRecentMessages: 1 },
		semantic: { deduplicate: true, minimumConfidence: 0.9 },
		qualityLevel: 'strict',
	},
	undefined,
	{
		deduplication: {
			deduplicate: async ({ units }) => {
				semanticCalls++;
				return {
					keepIds: units
						.filter((unit) => unit.protected || unit.index % 2 === 0)
						.map((unit) => unit.id),
					confidence: 0.98,
					compressorTokens: 40,
				};
			},
		},
	},
);

let judgeCalls = 0;
const repeated = [
	...Array.from({ length: 80 }, () => 'Repeated operational context approved.'),
	'Última mensagem permanece intacta.',
].join('\n');
const fallback = await optimizeContext(
	{ conversationHistory: repeated, currentMessage: 'Continue.' },
	{
		profile: 'custom',
		custom: { keepRecentMessages: 1 },
		semantic: { deduplicate: true, judge: true, minimumConfidence: 0.9 },
		qualityLevel: 'strict',
	},
	undefined,
	{
		deduplication: {
			deduplicate: async ({ units }) => ({
				keepIds: units.filter((unit) => unit.protected).map((unit) => unit.id),
				confidence: 0.99,
				compressorTokens: 1,
			}),
		},
		judge: {
			verify: async () => {
				judgeCalls++;
				return {
					meaningPreserved: false,
					missingFacts: [],
					contradictions: ['authorization polarity changed'],
					confidence: 0.99,
					verificationTokens: 20,
				};
			},
		},
	},
);

const polarityOriginal = 'Pedido ORD-8172 não foi autorizado.';
const polarityCandidate = 'Pedido ORD-8172 foi autorizado.';
const strict = checkContentQuality(
	polarityOriginal,
	polarityCandidate,
	manifest(polarityOriginal, polarityCandidate),
	undefined,
	'strict',
);
const protectedBlock =
	'<context-optimizer-protected>Valor exato R$ 12.850,00.</context-optimizer-protected>';
const block = checkContentQuality(
	protectedBlock,
	protectedBlock.replace('12.850,00', '12.500,00'),
	manifest(protectedBlock, protectedBlock),
	undefined,
	'fast',
);

const checks = {
	semanticOptInCalledOnce: semanticCalls === 1,
	semanticApplied:
		semantic.optimization.semanticMethods?.includes('semantic-deduplication') === true,
	semanticNetPositive: (semantic.optimization.netSavingsTokens ?? 0) > 0,
	protectedRecentPreserved: semantic.optimizedHistory.includes('ACCT-991'),
	judgeCalledOnce: judgeCalls === 1,
	judgeFallbackDeterministic: fallback.optimization.strategy === 'deterministic',
	noSecondPaidRetry: judgeCalls === 1,
	strictRejectedContradiction: !strict.passed && strict.warnings.includes('fact-polarity'),
	protectedBlockRejectedMutation: !block.passed && block.warnings.includes('protected-blocks'),
};
const passed = Object.values(checks).every(Boolean);
const result = {
	benchmark: 'Context Saver v0.9 semantic and adaptive quality guard',
	version: '0.9.0',
	providerCalls: 0,
	measurement: 'local token estimate with deterministic mock adapters',
	semantic: semantic.optimization,
	fallback: fallback.optimization,
	checks,
	passed,
	note: 'Mock adapters prove control flow and accounting; results are not a quality guarantee for an external model.',
};
const markdown = `# Context Saver v0.9 semantic and quality benchmark\n\nStatus: **${passed ? 'PASS' : 'FAIL'}**\n\n| Case | Before | After | Net saved | Strategy |\n|---|---:|---:|---:|---|\n| Semantic opt-in | ${semantic.optimization.tokensBefore} | ${semantic.optimization.tokensAfter} | ${semantic.optimization.netSavingsTokens} | ${semantic.optimization.strategy} |\n| Judge rejection fallback | ${fallback.optimization.tokensBefore} | ${fallback.optimization.tokensAfter} | ${fallback.optimization.netSavingsTokens} | ${fallback.optimization.strategy} |\n\n- Semantic adapter called once and protected recent context remained exact.\n- Judge called once; rejection used deterministic fallback without a second paid retry.\n- Strict verification rejected changed negation/polarity.\n- Fast verification rejected a byte change inside a protected block.\n- No provider or paid LLM call was made.\n`;

await mkdir(outputDirectory, { recursive: true });
await writeIfChanged(outputJson, `${JSON.stringify(result, null, 2)}\n`);
await writeIfChanged(outputMarkdown, markdown);
console.log(markdown);
if (!passed) process.exitCode = 1;
