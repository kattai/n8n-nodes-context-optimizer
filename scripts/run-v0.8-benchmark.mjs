import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { estimateTokens } = require('../dist/src/core/token-estimator.js');
const { FileSystemMemoryManager } = require('../dist/src/memory/memory-manager.js');
const { wrapLanguageModel } = require('../dist/src/model-wrapper/wrap-language-model.js');
const { stableSerialize } = require('../dist/src/context/canonical-context.js');

const root = resolve(import.meta.dirname, '..');
const outputDirectory = join(root, 'benchmarks', 'results');
const outputJson = join(outputDirectory, 'memory-tools-v0.8.0.json');
const outputMarkdown = join(outputDirectory, 'memory-tools-v0.8.0.md');
const workDirectory = await mkdtemp(join(tmpdir(), 'context-saver-v0.8-'));

function round(value) {
	return Number(value.toFixed(2));
}

function savings(before, after) {
	const saved = Math.max(0, before - after);
	return {
		before,
		after,
		saved,
		percent: before === 0 ? 0 : round((saved / before) * 100),
	};
}

function buildMessages() {
	return Array.from({ length: 120 }, (_, index) => {
		const role = index % 2 === 0 ? 'user' : 'assistant';
		let content =
			`Turn ${index}: operational discussion for account ACCT-${String(index % 18).padStart(3, '0')}. ` +
			`Evidence EVD-${String(index).padStart(4, '0')} covers delivery, payment, owner, deadline, ` +
			`status, exceptions, and follow-up. This deliberately unique detail represents normal growing chat history. ` +
			`The exact event remains archived even when it is no longer repeated in every model request.`;
		let kind;
		if (index === 14) {
			content = 'Correction: the approved account is ACCT-014, not ACCT-041.';
			kind = 'correction';
		}
		if (index === 15) {
			content = 'Pending: confirm the signed contract before creating the final order.';
			kind = 'pending';
		}
		if (index === 16) {
			content = 'Decision: use the shared calendar and keep exact meeting IDs.';
			kind = 'decision';
		}
		return { id: `message-${index}`, role, content, ...(kind ? { kind } : {}) };
	});
}

async function benchmarkMemory() {
	const manager = new FileSystemMemoryManager(join(workDirectory, 'memory'));
	const messages = buildMessages();
	const baseline = stableSerialize({
		factsSeenDuringConversation: {
			account: ['ACCT-041', 'ACCT-014'],
			priority: ['normal', 'high'],
		},
		messages,
	});
	await manager.updateSession({
		sessionKey: 'benchmark-session',
		scope: 'benchmark-workflow',
		recentWindow: 6,
		pinnedFacts: { account: 'ACCT-041', priority: 'normal', language: 'pt-BR' },
		structuredState: { stage: 'qualification', nextAction: 'confirm_contract' },
		messages,
		summaryCandidate:
			'Account qualification progressed. Delivery, payment, ownership, deadlines and exceptions were discussed. Exact historical events are archived. The signed contract remains pending.',
	});
	await manager.updateSession({
		sessionKey: 'benchmark-session',
		scope: 'benchmark-workflow',
		recentWindow: 6,
		pinnedFacts: { account: 'ACCT-014', priority: 'high' },
		structuredState: { stage: 'proposal' },
	});

	const built = await manager.buildContext({
		sessionKey: 'benchmark-session',
		scope: 'benchmark-workflow',
	});
	const inspected = await manager.inspectSession('benchmark-session', 'benchmark-workflow');
	const modelMemory = JSON.parse(built.context);
	const exactMessages = [...inspected.archivedEvents.map((event) => event.message), ...inspected.recentMessages];
	const qualityChecks = {
		currentFactPresent: modelMemory.currentFacts.account === 'ACCT-014',
		supersededFactNotCurrent: modelMemory.currentFacts.account !== 'ACCT-041',
		correctionProtected: built.context.includes('not ACCT-041'),
		pendingProtected: built.context.includes('signed contract'),
		recentWindowExact: built.included.recentMessages === 6,
		fullHistoryRecoverable: exactMessages.length === messages.length,
		factHistoryRecoverable: inspected.pinnedFacts.account.history[0]?.value === 'ACCT-041',
	};
	return {
		...savings(estimateTokens(baseline), built.estimatedTokens),
		recentMessagesSent: built.included.recentMessages,
		archivedMessages: built.archivedEventCount,
		qualityChecks,
		passed: Object.values(qualityChecks).every(Boolean),
	};
}

function buildTools() {
	const definitions = [
		['calendar_check_availability', 'Find free calendar dates and meeting time slots'],
		['calendar_create_event', 'Create a confirmed calendar meeting event'],
		['calendar_cancel_event', 'Cancel an existing calendar event'],
		['crm_find_contact', 'Find a CRM contact by email or identifier'],
		['crm_update_contact', 'Update selected CRM contact fields'],
		['crm_create_activity', 'Write an activity or note in the CRM'],
		['inventory_search', 'Search products, stock and warehouse availability'],
		['inventory_reserve', 'Reserve product quantity in a warehouse'],
		['orders_find', 'Find customer orders and their current status'],
		['orders_create', 'Create a customer order from validated items'],
		['orders_cancel', 'Cancel an eligible customer order'],
		['payments_status', 'Read payment authorization and settlement status'],
		['payments_refund', 'Request a payment refund after validation'],
		['shipping_quote', 'Calculate delivery price and estimated date'],
		['shipping_track', 'Track a shipment using its tracking identifier'],
		['support_find_ticket', 'Find a support ticket and its activity history'],
		['support_create_ticket', 'Create a support ticket for a customer'],
		['documents_search', 'Search indexed documents and exact sections'],
		['documents_create', 'Create a document from approved structured data'],
		['weather_forecast', 'Get a weather forecast for a location and date'],
		['maps_nearby_places', 'Find nearby places for geographic planning'],
		['analytics_sales_report', 'Generate a sales report for a date range'],
		['users_find', 'Find an internal user and team permissions'],
		['notifications_send', 'Send an approved internal notification'],
	];
	return definitions.map(([name, description]) => ({
		name,
		description,
		schema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: `Search input for ${name}` },
				tenantId: { type: 'string', description: 'Exact tenant identifier' },
				startDate: { type: 'string', format: 'date-time' },
				endDate: { type: 'string', format: 'date-time' },
				fields: { type: 'array', items: { type: 'string' } },
				filters: { type: 'object', additionalProperties: true },
				limit: { type: 'integer', minimum: 1, maximum: 100 },
				includeMetadata: { type: 'boolean', default: false },
			},
			required: ['query', 'tenantId'],
			additionalProperties: false,
		},
	}));
}

class RecordingToolModel {
	constructor(state, boundTools = []) {
		this.state = state;
		this.boundTools = boundTools;
	}

	bindTools(tools) {
		this.state.bindings.push(tools);
		return new RecordingToolModel(this.state, tools);
	}

	async invoke(input) {
		this.state.invocation = { input, tools: this.boundTools };
		return { content: 'ok' };
	}
}

async function benchmarkTools() {
	const tools = buildTools();
	const state = { bindings: [], invocation: undefined };
	const metrics = [];
	const wrapped = wrapLanguageModel(new RecordingToolModel(state), {
		profile: 'savings',
		cacheAware: { strategy: 'token_reduction_priority' },
		toolSelection: {
			mode: 'automatic',
			minimumToolCount: 8,
			maximumSelectedTools: 4,
			tokenBudget: 1600,
		},
		observer: { onStart: (value) => metrics.push(value) },
	});
	const bound = wrapped.bindTools(tools);
	await bound.invoke([
		{
			role: 'user',
			content:
				'Use calendar_check_availability to find free meeting time slots next Tuesday.',
		},
	]);
	const selected = state.invocation.tools;
	const firstMetrics = metrics[0];
	const result = savings(
		firstMetrics.toolSchemaTokensBefore,
		firstMetrics.toolSchemaTokensAfter,
	);
	const selectedNames = selected.map((tool) => tool.name);
	const qualityChecks = {
		targetToolPresent: selectedNames.includes('calendar_check_availability'),
		originalToolObjectsPreserved: selected.every((tool) => tools.includes(tool)),
		selectionActuallyReachedProvider: selected.length === firstMetrics.toolSchemasAfter,
		selectionWasSafe: firstMetrics.toolSchemaSelectionReason === 'selected',
		allToolsCounted: firstMetrics.toolSchemasBefore === tools.length,
	};
	return {
		...result,
		toolsBefore: tools.length,
		toolsAfter: selected.length,
		selectedNames,
		confidence: firstMetrics.toolSchemaSelectionConfidence,
		qualityChecks,
		passed: Object.values(qualityChecks).every(Boolean),
	};
}

async function writeIfChanged(path, content) {
	let existing = '';
	try {
		existing = await readFile(path, 'utf8');
	} catch {
		// First benchmark run creates the artifact.
	}
	if (existing !== content) await writeFile(path, content, 'utf8');
}

try {
	const memory = await benchmarkMemory();
	const tools = await benchmarkTools();
	const passed = memory.passed && tools.passed && memory.percent >= 70 && tools.percent >= 60;
	const result = {
		benchmark: 'Context Saver v0.8 memory and lazy tool schemas',
		version: '0.8.0',
		generatedFor: '2026-07-31 release',
		providerCalls: 0,
		measurement: 'model-aware local token estimate',
		memory,
		tools,
		passed,
		note: 'Results describe this deterministic corpus; they are not guarantees for arbitrary workflows.',
	};
	const markdown = `# Context Saver v0.8 memory and tools benchmark\n\nStatus: **${passed ? 'PASS' : 'FAIL'}**\n\n| Surface | Before | After | Saved | Reduction | Integrity |\n|---|---:|---:|---:|---:|---:|\n| Growing conversation memory | ${memory.before} | ${memory.after} | ${memory.saved} | ${memory.percent}% | ${memory.passed ? '100%' : 'FAIL'} |\n| Tool schemas sent to model | ${tools.before} | ${tools.after} | ${tools.saved} | ${tools.percent}% | ${tools.passed ? '100%' : 'FAIL'} |\n\n## What was verified\n\n- Memory sends only the current fact, protected corrections/pending work, structured state, summary, and six recent messages.\n- All 120 exact messages and superseded fact versions remain recoverable from the scoped archive.\n- The model binding received ${tools.toolsAfter} of ${tools.toolsBefore} tools for a clear calendar task; the required tool and original tool objects were preserved.\n- Low-confidence, Quality, Cache Priority, and ambiguous structured-output fallbacks are covered by the automated test suite and keep all tools.\n- No paid provider call or semantic compressor was used. Percentages are estimated for this deterministic corpus, not guaranteed for every workflow.\n`;
	await mkdir(outputDirectory, { recursive: true });
	await writeIfChanged(outputJson, `${JSON.stringify(result, null, 2)}\n`);
	await writeIfChanged(outputMarkdown, markdown);
	console.log(markdown);
	if (!passed) process.exitCode = 1;
} finally {
	await rm(workDirectory, { recursive: true, force: true });
}
