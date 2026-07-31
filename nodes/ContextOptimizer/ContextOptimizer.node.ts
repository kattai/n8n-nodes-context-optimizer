import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { optimizeContent } from '../../src/content/optimize-content';
import type { ContentOptimizationOptions, ContentType } from '../../src/content/types';
import type { QualityVerificationLevel } from '../../src/quality/verification-policy';
import { optimizeContext } from '../../src/core/optimizer';
import { estimateTokens } from '../../src/core/token-estimator';
import { resolvePreviewPolicy } from '../../src/policy/preview-policy';
import type {
	CustomProfileConfig,
	OptimizerProfileName,
	SummaryAdapter,
	SummaryRequest,
} from '../../src/core/types';
import type {
	SemanticPipelineAdapters,
	SemanticSelectionRequest,
	SemanticJudgeRequest,
} from '../../src/semantic/types';
import {
	defaultStorageDirectory,
	FileSystemResourceStore,
} from '../../src/storage/filesystem-store';
import { virtualizeContext } from '../../src/virtualization/context-virtualizer';
import {
	contentOutput,
	contextOutput,
	type OutputDetail,
} from '../../src/output/format-node-output';

interface InvokableModel {
	invoke(input: unknown, config?: { signal?: AbortSignal }): Promise<unknown>;
}

type ContextOptimizerOperation = 'buildAgentContext' | 'compileStaticPrompt' | 'optimizeContent';

interface VirtualizationNodeOptions {
	allowSecretLikeContent?: boolean;
	thresholdTokens?: number;
	maxPreviewTokens?: number;
	maxItems?: number;
	ttlHours?: number;
	scope?: string;
	storageDirectory?: string;
	maxResourceMegabytes?: number;
}

interface SemanticNodeOptions {
	deduplicate?: boolean;
	judge?: boolean;
	maximumSelectedUnits?: number;
	maximumUnits?: number;
	minimumConfidence?: number;
	rerank?: boolean;
	summary?: boolean;
	tokenBudget?: number;
}

function list(value: string): string[] {
	return value
		.split(/\r?\n|,/)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function responseText(response: unknown): string {
	if (typeof response === 'string') return response;
	if (!response || typeof response !== 'object') return '';
	if ('content' in response) {
		const content = (response as { content: unknown }).content;
		if (typeof content === 'string') return content;
		if (Array.isArray(content)) {
			return content
				.map((entry) => {
					if (typeof entry === 'string') return entry;
					if (entry && typeof entry === 'object' && 'text' in entry) {
						return String((entry as { text: unknown }).text);
					}
					return '';
				})
				.filter(Boolean)
				.join('\n');
		}
	}
	return '';
}

function summaryPrompt(request: SummaryRequest): string {
	return [
		'Compacte o contexto abaixo sem criar fatos.',
		'Preserve literalmente todos os valores protegidos.',
		`Limite aproximado: ${request.maxTokens} tokens.`,
		`Valores protegidos: ${JSON.stringify(request.protectedValues)}`,
		'Retorne somente o resumo, sem introdução.',
		'CONTEXTO:',
		request.text,
	].join('\n\n');
}

function semanticSelectionPrompt(
	operation: 'deduplicate' | 'rerank',
	request: SemanticSelectionRequest,
): string {
	const instruction =
		operation === 'deduplicate'
			? 'Return the IDs that must remain after removing only semantically redundant units.'
			: 'Rank every useful unit ID from most to least relevant to the current task.';
	return [
		'You are a context selection adapter. Never rewrite facts.',
		instruction,
		'Every protected ID must be included. Never create IDs.',
		operation === 'deduplicate'
			? 'Return JSON only: {"keepIds":["..."],"confidence":0.0}'
			: 'Return JSON only: {"rankedIds":["..."],"confidence":0.0}',
		`Current task: ${request.currentTask}`,
		`Protected IDs: ${JSON.stringify(request.protectedIds)}`,
		`Units: ${JSON.stringify(request.units.map(({ id, source, text, protected: isProtected }) => ({ id, source, text, protected: isProtected })))}`,
	].join('\n\n');
}

function semanticJudgePrompt(request: SemanticJudgeRequest): string {
	return [
		'Compare original and candidate context. Detect omissions or contradictions.',
		'Protected values must remain exact. Do not repair the candidate.',
		'Return JSON only: {"meaningPreserved":true,"missingFacts":[],"contradictions":[],"confidence":0.0}',
		`Current task: ${request.currentTask}`,
		`Protected values: ${JSON.stringify(request.protectedValues)}`,
		`Original: ${request.original}`,
		`Candidate: ${request.candidate}`,
	].join('\n\n');
}

function responseJson(response: unknown): Record<string, unknown> {
	const text = responseText(response).trim();
	const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
	const start = unfenced.indexOf('{');
	const end = unfenced.lastIndexOf('}');
	if (start < 0 || end < start) return {};
	try {
		const value = JSON.parse(unfenced.slice(start, end + 1)) as unknown;
		return value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === 'string')
		: [];
}

function confidence(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

const summaryTimeout = Symbol('summary-timeout');

async function withTimeout<T>(
	call: (signal: AbortSignal) => Promise<T>,
	timeoutMs: number,
): Promise<T | typeof summaryTimeout> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await Promise.race([
			call(controller.signal),
			new Promise<typeof summaryTimeout>((resolve) => {
				controller.signal.addEventListener('abort', () => resolve(summaryTimeout), {
					once: true,
				});
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

export class ContextOptimizer implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Context Saver Content',
		name: 'contextOptimizer',
		icon: {
			light: 'file:context-optimizer.svg',
			dark: 'file:context-optimizer.dark.svg',
		},
		// Runtime must stay false: n8n already generates a separate tool variant when true.
		// @ts-expect-error n8n's public type currently omits the supported false value.
		usableAsTool: false,
		group: ['transform'],
		version: [1, 2],
		defaultVersion: 2,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Compress large data before adding it to an AI prompt; use for JSON, RAG, logs, HTML, or static prompts',
		defaults: {
			name: 'Context Saver Content',
		},
		inputs: [
			NodeConnectionTypes.Main,
			{
				displayName: 'Experimental Compression Model',
				type: NodeConnectionTypes.AiLanguageModel,
				required: false,
				maxConnections: 1,
			},
		],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Build Agent Context',
						value: 'buildAgentContext',
						description:
							'Use when prompt, history, RAG, and tool definitions are already available as separate fields',
						action: 'Build optimized agent context',
					},
					{
						name: 'Compile Static Prompt',
						value: 'compileStaticPrompt',
						description:
							'Use once for a repeated static prompt; returns a smaller stable prompt and hash',
						action: 'Compile a static prompt',
					},
					{
						name: 'Optimize Content',
						value: 'optimizeContent',
						description:
							'Use before an agent when one field contains large JSON, logs, HTML, RAG, or tool output',
						action: 'Optimize content',
					},
				],
				default: 'buildAgentContext',
			},
			{
				displayName: 'System Prompt',
				name: 'systemPrompt',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '={{ $json.systemPrompt || "" }}',
				displayOptions: { show: { operation: ['buildAgentContext'] } },
				description: 'Permanent instructions supplied to the AI agent',
			},
			{
				displayName: 'Conversation History',
				name: 'conversationHistory',
				type: 'string',
				typeOptions: { rows: 5 },
				default: '={{ $json.conversationHistory || $json.history || "" }}',
				displayOptions: { show: { operation: ['buildAgentContext'] } },
				description: 'Messages that occurred before the current user message',
			},
			{
				displayName: 'Retrieved Context',
				name: 'retrievedContext',
				type: 'string',
				typeOptions: { rows: 5 },
				default: '={{ $json.retrievedContext || $json.context || "" }}',
				displayOptions: { show: { operation: ['buildAgentContext'] } },
				description: 'RAG documents and tool results available to the agent',
			},
			{
				displayName: 'Tool Definitions',
				name: 'toolDefinitions',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '={{ $json.toolDefinitions || "" }}',
				displayOptions: { show: { operation: ['buildAgentContext'] } },
				description: 'Tool names, descriptions, and schemas to preserve',
			},
			{
				displayName: 'Current Message',
				name: 'currentMessage',
				type: 'string',
				typeOptions: { rows: 3 },
				required: true,
				default: '={{ $json.currentMessage || $json.chatInput || "" }}',
				displayOptions: { show: { operation: ['buildAgentContext'] } },
				description: 'Current user message, which the node never changes',
			},
			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				typeOptions: { rows: 8 },
				required: true,
				default: '={{ $json.content || "" }}',
				displayOptions: {
					show: { operation: ['compileStaticPrompt', 'optimizeContent'] },
				},
				description: 'Only this value is optimized; the simple output does not copy the original',
			},
			{
				displayName: 'Content Type',
				name: 'contentType',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Auto Detect (Recommended)',
						value: 'auto',
						description: 'Choose a safe compressor from the input shape',
					},
					{
						name: 'Code',
						value: 'code',
						description: 'Preserve code exactly; only measure its size',
					},
					{
						name: 'HTML',
						value: 'html',
						description: 'Remove scripts, styles, navigation, and other page boilerplate',
					},
					{
						name: 'JSON or API Response',
						value: 'json',
						description: 'Minify objects and convert repeated records to a shared-schema table',
					},
					{
						name: 'Logs',
						value: 'logs',
						description: 'Remove ANSI codes and collapse consecutive identical lines',
					},
					{
						name: 'RAG Documents',
						value: 'rag',
						description: 'Remove exactly repeated document chunks',
					},
					{
						name: 'Text',
						value: 'text',
						description: 'Normalize formatting and remove exact repeated paragraphs',
					},
					{
						name: 'Tool Output',
						value: 'tool_output',
						description: 'Optimize a result that will be returned to an AI Agent',
					},
				],
				default: 'auto',
				displayOptions: { show: { operation: ['optimizeContent'] } },
				description: 'Content-specific compressor to apply',
			},
			{
				displayName: 'Current Task',
				name: 'currentTask',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '={{ $json.currentTask || $json.chatInput || "" }}',
				displayOptions: { show: { operation: ['optimizeContent'] } },
				description:
					'Used only to choose the most relevant preview rows when Context Virtualization is enabled',
			},
			{
				displayName: 'Content Options',
				name: 'contentOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { operation: ['optimizeContent'] } },
				options: [
					{
						displayName: 'Fields to Exclude',
						name: 'excludeFields',
						type: 'string',
						default: '',
						placeholder: 'metadata, debug',
						description:
							'JSON only: remove these top-level fields; excluded data is unavailable unless virtualization stores the original',
					},
					{
						displayName: 'Fields to Include',
						name: 'includeFields',
						type: 'string',
						default: '',
						placeholder: 'orderId, status, total',
						description: 'JSON only: keep these top-level fields and remove the others',
					},
					{
						displayName: 'Remove Empty Strings',
						name: 'removeEmptyStrings',
						type: 'boolean',
						default: false,
						description: 'Whether to remove JSON fields containing empty strings',
					},
					{
						displayName: 'Remove Null Fields',
						name: 'removeNulls',
						type: 'boolean',
						default: false,
						description: 'Whether to remove JSON fields containing null',
					},
				],
			},
			{
				displayName: 'Protected Values',
				name: 'protectedValues',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				placeholder: 'One value per line',
				description:
					'One exact value per line; any missing value makes the node fall back to the original',
			},
			{
				displayName: 'Enable Context Virtualization',
				name: 'enableVirtualization',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: { '@version': [1], operation: ['optimizeContent'] },
				},
				description:
					'Whether to store large original content and return a smaller preview; connect Context Saver Retriever to the agent',
			},
			{
				displayName: 'Context Virtualization',
				name: 'virtualizationMode',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Automatic (Recommended)',
						value: 'automatic',
						description:
							'Store only large eligible content when doing so produces positive savings; Quality stays inline',
						action: 'Virtualize automatically',
					},
					{
						name: 'Disabled',
						value: 'disabled',
						description: 'Keep optimized content inline and do not create a recoverable resource',
						action: 'Disable context virtualization',
					},
					{
						name: 'Required',
						value: 'required',
						description:
							'Require storage and a smaller recoverable preview; fail if safe virtualization cannot be completed',
						action: 'Require recoverable virtualization',
					},
				],
				default: 'automatic',
				displayOptions: {
					show: { '@version': [2], operation: ['optimizeContent'] },
				},
				description: 'Controls when exact original content moves outside the model prompt',
			},
			{
				displayName: 'Virtualization Options',
				name: 'virtualizationOptions',
				type: 'collection',
				placeholder: 'Add Setting',
				default: {},
				displayOptions: {
					show: {
						'@version': [1],
						operation: ['optimizeContent'],
						enableVirtualization: [true],
					},
				},
				options: [
					{
						displayName: 'Maximum Preview Items',
						name: 'maxItems',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 1000, numberPrecision: 0 },
						default: 20,
						description: 'Maximum records, log lines, or chunks included in the prompt',
					},
					{
						displayName: 'Maximum Preview Tokens',
						name: 'maxPreviewTokens',
						type: 'number',
						typeOptions: { minValue: 100, maxValue: 32000, numberPrecision: 0 },
						default: 1500,
						description: 'Approximate token budget for the compact preview',
					},
					{
						displayName: 'Maximum Resource Size (MB)',
						name: 'maxResourceMegabytes',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 1024, numberPrecision: 0 },
						default: 10,
						description: 'Maximum uncompressed content stored for exact retrieval',
					},
					{
						displayName: 'Scope',
						name: 'scope',
						type: 'string',
						default: '={{ $workflow.id }}',
						description: 'Must match the Context Retriever Tool scope',
					},
					{
						displayName: 'Storage Directory',
						name: 'storageDirectory',
						type: 'string',
						default: '',
						placeholder: defaultStorageDirectory(),
						description: 'Must match the Context Retriever Tool directory',
					},
					{
						displayName: 'Threshold Tokens',
						name: 'thresholdTokens',
						type: 'number',
						typeOptions: { minValue: 100, maxValue: 1000000, numberPrecision: 0 },
						default: 2000,
						description: 'Content below this approximate size remains inline and is not stored',
					},
					{
						displayName: 'TTL (Hours)',
						name: 'ttlHours',
						type: 'number',
						typeOptions: { minValue: 0.02, maxValue: 8760, numberPrecision: 2 },
						default: 24,
						description: 'Hours before the original resource expires',
					},
				],
			},
			{
				displayName: 'Virtualization Options',
				name: 'virtualizationOptionsV2',
				type: 'collection',
				placeholder: 'Add Setting',
				default: {},
				displayOptions: {
					show: {
						'@version': [2],
						operation: ['optimizeContent'],
						virtualizationMode: ['automatic', 'required'],
					},
				},
				options: [
					{
						displayName: 'Allow Secret-Like Content Storage',
						name: 'allowSecretLikeContent',
						type: 'boolean',
						default: false,
						description:
							'Whether secured storage may contain values resembling API keys, passwords, or private keys',
					},
					{
						displayName: 'Maximum Preview Items',
						name: 'maxItems',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 1000, numberPrecision: 0 },
						default: 20,
						description: 'Maximum relevant records, log lines, or chunks retained inline',
					},
					{
						displayName: 'Maximum Preview Tokens',
						name: 'maxPreviewTokens',
						type: 'number',
						typeOptions: { minValue: 100, maxValue: 32000, numberPrecision: 0 },
						default: 1500,
						description: 'Hard token target for the relevant inline preview',
					},
					{
						displayName: 'Minimum Content Tokens',
						name: 'thresholdTokens',
						type: 'number',
						typeOptions: { minValue: 100, maxValue: 1000000, numberPrecision: 0 },
						default: 2000,
						description:
							'Automatic mode keeps smaller content inline because storage overhead may cost more',
					},
					{
						displayName: 'Scope',
						name: 'scope',
						type: 'string',
						default: '={{ $workflow.id }}',
						description: 'Isolation key that must match Context Saver Retriever',
					},
					{
						displayName: 'Storage Directory',
						name: 'storageDirectory',
						type: 'string',
						default: '',
						placeholder: defaultStorageDirectory(),
						description: 'Shared self-hosted path also configured in Context Saver Retriever',
					},
					{
						displayName: 'TTL (Hours)',
						name: 'ttlHours',
						type: 'number',
						typeOptions: { minValue: 0.02, maxValue: 8760, numberPrecision: 2 },
						default: 24,
						description: 'How long exact content remains retrievable',
					},
				],
			},
			{
				displayName: 'Optimization Level',
				name: 'profile',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: { '@version': [1], operation: ['buildAgentContext'] },
				},
				options: [
					{
						name: 'Maximum Quality',
						value: 'safe',
						description: 'Preserve the latest 12 messages and remove only exact older duplicates',
						action: 'Maximize context quality',
					},
					{
						name: 'Balanced (Recommended)',
						value: 'balanced',
						description: 'Preserve the latest 6 messages and compress older exact repetition',
						action: 'Balance context quality and size',
					},
					{
						name: 'Maximum Savings',
						value: 'aggressive',
						description: 'Preserve the latest 3 messages and merge polarity-safe near-duplicates',
						action: 'Maximize context savings',
					},
					{
						name: 'Custom (Advanced)',
						value: 'custom',
						description:
							'Control the recent window, token target, and optional unique-content trimming',
						action: 'Optimize context with custom limits',
					},
				],
				default: 'balanced',
				description: 'Default levels never remove unique content merely to meet a token budget',
			},
			{
				displayName: 'Profile',
				name: 'profile',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { '@version': [2] } },
				options: [
					{
						name: 'Quality',
						value: 'quality',
						description:
							'Typical eligible saving: 15–35%. Deterministic, reversible optimization with maximum fidelity.',
						action: 'Prioritize content fidelity',
					},
					{
						name: 'Balanced (Recommended)',
						value: 'balanced',
						description:
							'Typical eligible saving: 35–60%. Conservative task-aware selection with recoverable omission.',
						action: 'Balance fidelity and savings',
					},
					{
						name: 'Savings',
						value: 'savings',
						description:
							'Typical eligible saving: 60–85%. Small task-aware previews with exact recovery for missing details.',
						action: 'Maximize recoverable savings',
					},
					{
						name: 'Custom (Advanced)',
						value: 'custom',
						description:
							'Use manual retention and budget settings for specialized context requirements',
						action: 'Use a custom content policy',
					},
				],
				default: 'balanced',
				description:
					'The typical range applies only to context that is safe and eligible to optimize',
			},
			{
				displayName: 'Custom Profile',
				name: 'customProfile',
				type: 'collection',
				placeholder: 'Add Setting',
				default: {},
				displayOptions: {
					show: { operation: ['buildAgentContext'], profile: ['custom'] },
				},
				options: [
					{
						displayName: 'Allow Unique Content Trimming',
						name: 'allowUniqueContentTrimming',
						type: 'boolean',
						default: false,
						description:
							'Whether to remove older unique history to meet the budget; risky unless the original is retrievable elsewhere',
					},
					{
						displayName: 'Approximate Deduplication',
						name: 'approximateDeduplication',
						type: 'boolean',
						default: true,
						description:
							'Whether to merge near-duplicates when negation and instruction polarity match',
					},
					{
						displayName: 'Keep Recent Messages',
						name: 'keepRecentMessages',
						type: 'number',
						typeOptions: { minValue: 0, numberPrecision: 0 },
						default: 6,
						description: 'Number of recent messages preserved in full',
					},
					{
						displayName: 'Maximum Input Tokens',
						name: 'maxInputTokens',
						type: 'number',
						typeOptions: { minValue: 1, numberPrecision: 0 },
						default: 16000,
						description:
							'Budget target; unique content remains unless trimming is explicitly allowed below',
					},
					{
						displayName: 'Summary Threshold Tokens',
						name: 'summaryThresholdTokens',
						type: 'number',
						typeOptions: { minValue: 1, numberPrecision: 0 },
						default: 8000,
						description: 'Run the optional compression model only above this estimated size',
					},
				],
			},
			{
				displayName: 'Quality Verification',
				name: 'qualityLevel',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { '@version': [2] } },
				options: [
					{
						name: 'Fast',
						value: 'fast',
						description: 'Check exact protected values, blocks, non-empty output, and structure',
						action: 'Run fast verification',
					},
					{
						name: 'Strict (Recommended)',
						value: 'strict',
						description: 'Also reject changed negations and protected-value polarity',
						action: 'Run strict verification',
					},
					{
						name: 'Critical',
						value: 'critical',
						description: 'Also require quoted values to remain exact; best for sensitive workflows',
						action: 'Run critical verification',
					},
				],
				default: 'strict',
				description: 'Deterministic checks always run; failed candidates fall back safely',
			},
			{
				displayName: 'Experimental Semantic Compression',
				name: 'useSummarizer',
				type: 'boolean',
				default: false,
				displayOptions: { show: { operation: ['buildAgentContext'] } },
				description:
					'Whether to use the connected model to summarize old context; may omit nuance and falls back when protected facts are lost',
			},
			{
				displayName: 'Compression Model Timeout (Ms)',
				name: 'summarizerTimeoutMs',
				type: 'number',
				typeOptions: { minValue: 1000, maxValue: 120000, numberPrecision: 0 },
				default: 30000,
				displayOptions: {
					show: {
						operation: ['buildAgentContext'],
						useSummarizer: [true],
					},
				},
				description: 'Maximum time to wait for a summary before falling back',
			},
			{
				displayName: 'Semantic Pipeline',
				name: 'semanticOptions',
				type: 'collection',
				placeholder: 'Add Experimental Setting',
				default: {},
				displayOptions: {
					show: { '@version': [2], operation: ['buildAgentContext'], useSummarizer: [true] },
				},
				description:
					'Optional paid adapter calls; every stage is measured and falls back to deterministic context',
				options: [
					{
						displayName: 'LLM Judge',
						name: 'judge',
						type: 'boolean',
						default: false,
						description:
							'Whether to make one verification call; deterministic protected-fact checks still run',
					},
					{
						displayName: 'LLM Summary',
						name: 'summary',
						type: 'boolean',
						default: true,
						description: 'Whether to make one summary call above the configured threshold',
					},
					{
						displayName: 'Maximum Selected Units',
						name: 'maximumSelectedUnits',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 100, numberPrecision: 0 },
						default: 12,
						description: 'Maximum units retained by task reranking, including protected units',
					},
					{
						displayName: 'Maximum Units per Adapter Call',
						name: 'maximumUnits',
						type: 'number',
						typeOptions: { minValue: 2, maxValue: 200, numberPrecision: 0 },
						default: 40,
						description: 'Larger inputs skip semantic selection instead of causing a costly call',
					},
					{
						displayName: 'Minimum Confidence',
						name: 'minimumConfidence',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
						default: 0.85,
						description: 'Lower-confidence adapter output is ignored',
					},
					{
						displayName: 'Reranked Context Token Budget',
						name: 'tokenBudget',
						type: 'number',
						typeOptions: { minValue: 50, maxValue: 128000, numberPrecision: 0 },
						default: 4000,
						description: 'Hard estimated budget for selected semantic units',
					},
					{
						displayName: 'Semantic Deduplication',
						name: 'deduplicate',
						type: 'boolean',
						default: false,
						description:
							'Whether to make one adapter call that removes only confident redundant units; protected and recent units remain',
					},
					{
						displayName: 'Task Reranking',
						name: 'rerank',
						type: 'boolean',
						default: false,
						description:
							'Whether to make one relevance call; requires Custom profile with Allow Unique Content Trimming',
					},
				],
			},
			{
				displayName: 'Output',
				name: 'outputDetail',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Simple (Recommended)',
						value: 'simple',
						description: 'Return only optimized content and a short savings summary',
						action: 'Return a simple output',
					},
					{
						name: 'Detailed Diagnostics',
						value: 'detailed',
						description:
							'Also return strategies, quality checks, manifests, and virtualization details',
						action: 'Return detailed diagnostics',
					},
				],
				default: 'simple',
				description:
					'Simple output prevents the original large value from being passed to the agent by accident',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const nodeVersion = this.getNode().typeVersion ?? 1;
				const operation = this.getNodeParameter(
					'operation',
					itemIndex,
					'buildAgentContext',
				) as ContextOptimizerOperation;
				const profile = this.getNodeParameter(
					'profile',
					itemIndex,
					'balanced',
				) as OptimizerProfileName;
				const outputDetail = this.getNodeParameter(
					'outputDetail',
					itemIndex,
					'simple',
				) as OutputDetail;
				const custom = this.getNodeParameter('customProfile', itemIndex, {}) as CustomProfileConfig;
				const qualityLevel = this.getNodeParameter(
					'qualityLevel',
					itemIndex,
					'strict',
				) as QualityVerificationLevel;

				if (operation === 'compileStaticPrompt' || operation === 'optimizeContent') {
					const content = this.getNodeParameter('content', itemIndex, '') as string;
					const protectedValues = this.getNodeParameter('protectedValues', itemIndex, '') as string;
					const contentOptions = this.getNodeParameter('contentOptions', itemIndex, {}) as {
						includeFields?: string;
						excludeFields?: string;
						removeNulls?: boolean;
						removeEmptyStrings?: boolean;
					};
					const options: ContentOptimizationOptions = {
						contentType:
							operation === 'compileStaticPrompt'
								? 'text'
								: (this.getNodeParameter('contentType', itemIndex, 'auto') as ContentType),
						currentTask:
							operation === 'optimizeContent'
								? (this.getNodeParameter('currentTask', itemIndex, '') as string)
								: '',
						profile,
						protectedValues,
						includeFields: list(contentOptions.includeFields ?? ''),
						excludeFields: list(contentOptions.excludeFields ?? ''),
						removeNulls: contentOptions.removeNulls,
						removeEmptyStrings: contentOptions.removeEmptyStrings,
						qualityLevel,
					};
					let result = optimizeContent(content, options);
					let contextVirtualization: Record<string, unknown> = {
						applied: false,
						exactRetrievalRequired: false,
					};
					const virtualizationMode =
						nodeVersion >= 2
							? (this.getNodeParameter('virtualizationMode', itemIndex, 'automatic') as
									| 'automatic'
									| 'disabled'
									| 'required')
							: (this.getNodeParameter('enableVirtualization', itemIndex, false) as boolean)
								? 'automatic'
								: 'disabled';
					const enableVirtualization =
						operation === 'optimizeContent' &&
						(virtualizationMode === 'required' ||
							(virtualizationMode === 'automatic' && profile !== 'quality' && profile !== 'safe'));
					if (enableVirtualization) {
						const virtualizationOptions = this.getNodeParameter(
							nodeVersion >= 2 ? 'virtualizationOptionsV2' : 'virtualizationOptions',
							itemIndex,
							{},
						) as VirtualizationNodeOptions;
						const eligibleTokens = estimateTokens(result.optimizedContent);
						const previewPolicy = resolvePreviewPolicy(profile, eligibleTokens);
						const thresholdTokens =
							virtualizationMode === 'required'
								? 0
								: (virtualizationOptions.thresholdTokens ?? previewPolicy.thresholdTokens);
						if (eligibleTokens > thresholdTokens) {
							try {
								const store = new FileSystemResourceStore(
									virtualizationOptions.storageDirectory?.trim() || defaultStorageDirectory(),
									(virtualizationOptions.maxResourceMegabytes ?? 10) * 1024 * 1024,
								);
								const resource = await store.store({
									content,
									contentType: result.contentType,
									ttlSeconds: (virtualizationOptions.ttlHours ?? 24) * 3600,
									scope: virtualizationOptions.scope?.trim() || this.getWorkflow().id || 'workflow',
									recordCount: result.manifest.recordCount,
									fields: result.manifest.fields,
									allowSecretLikeContent: virtualizationOptions.allowSecretLikeContent ?? false,
								});
								const virtualized = virtualizeContext(
									result.optimizedContent,
									result.contentType,
									resource.resourceId,
									{
										thresholdTokens,
										maxPreviewTokens:
											virtualizationOptions.maxPreviewTokens ?? previewPolicy.maxPreviewTokens,
										maxItems: virtualizationOptions.maxItems ?? previewPolicy.maxItems,
										currentTask: options.currentTask,
										recordCount: result.manifest.recordCount,
										fields: result.manifest.fields,
									},
								);
								if (virtualized.applied && virtualized.previewTokens < result.tokens.optimized) {
									const saved = Math.max(0, result.tokens.original - virtualized.previewTokens);
									result = {
										...result,
										optimizedContent: virtualized.content,
										strategies: [
											...result.strategies,
											'task-aware-preview',
											'context-virtualization',
										],
										tokens: {
											original: result.tokens.original,
											optimized: virtualized.previewTokens,
											saved,
											savingsPercent:
												result.tokens.original === 0
													? 0
													: Number(((saved / result.tokens.original) * 100).toFixed(2)),
											areEstimated: true,
										},
										manifest: {
											...result.manifest,
											optimizedBytes: Buffer.byteLength(virtualized.content),
										},
									};
									contextVirtualization = {
										...virtualized,
										originalStored: true,
										expiresAt: resource.expiresAt,
										originalHash: resource.originalHash,
										qualityPassed: true,
									};
								} else {
									await store.delete(resource.resourceId);
									if (virtualizationMode === 'required') {
										throw new NodeOperationError(
											this.getNode(),
											'Required virtualization produced no positive token savings',
											{ itemIndex },
										);
									}
									contextVirtualization = {
										applied: false,
										exactRetrievalRequired: false,
										fallbackReason: 'no_positive_savings',
									};
								}
							} catch (error) {
								if (virtualizationMode === 'required') {
									throw new NodeOperationError(
										this.getNode(),
										error instanceof Error ? error : new Error(String(error)),
										{ itemIndex },
									);
								}
								contextVirtualization = {
									applied: false,
									exactRetrievalRequired: false,
									fallbackReason: 'storage_error',
									warning: error instanceof Error ? error.message : String(error),
								};
							}
						}
					}
					returnData.push({
						json: contentOutput(
							operation,
							result,
							contextVirtualization,
							outputDetail,
						) as unknown as IDataObject,
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				const useSummarizer = this.getNodeParameter('useSummarizer', itemIndex, false) as boolean;
				const timeoutMs = this.getNodeParameter('summarizerTimeoutMs', itemIndex, 30000) as number;
				const semanticNodeOptions =
					nodeVersion >= 2
						? (this.getNodeParameter('semanticOptions', itemIndex, {}) as SemanticNodeOptions)
						: {};

				let summaryAdapter: SummaryAdapter | undefined;
				const semanticAdapters: SemanticPipelineAdapters = {};
				if (useSummarizer) {
					const connected = (await this.getInputConnectionData(
						NodeConnectionTypes.AiLanguageModel,
						itemIndex,
					)) as InvokableModel | undefined;
					if (!connected?.invoke) {
						throw new NodeOperationError(
							this.getNode(),
							'Connect a compression model or disable Experimental Semantic Compression',
							{ itemIndex },
						);
					}
					const invokeStructured = async (
						prompt: string,
					): Promise<{ value: Record<string, unknown>; tokens: number }> => {
						const response = await withTimeout(
							(signal) => connected.invoke(prompt, { signal }),
							timeoutMs,
						);
						if (response === summaryTimeout) {
							throw new NodeOperationError(this.getNode(), 'Semantic adapter timeout', {
								itemIndex,
							});
						}
						return {
							value: responseJson(response),
							tokens: estimateTokens(prompt) + estimateTokens(responseText(response)),
						};
					};
					if (semanticNodeOptions.summary !== false)
						summaryAdapter = {
							summarize: async (request) => {
								const prompt = summaryPrompt(request);
								const response = await withTimeout(
									(signal) => connected.invoke(prompt, { signal }),
									timeoutMs,
								);
								if (response === summaryTimeout) {
									throw new NodeOperationError(this.getNode(), 'Compression model timeout', {
										itemIndex,
									});
								}
								const text = responseText(response);
								return {
									text,
									warnings: [],
									compressorTokens: estimateTokens(prompt) + estimateTokens(text),
								};
							},
						};
					if (semanticNodeOptions.deduplicate) {
						semanticAdapters.deduplication = {
							deduplicate: async (request) => {
								const result = await invokeStructured(
									semanticSelectionPrompt('deduplicate', request),
								);
								return {
									keepIds: stringArray(result.value.keepIds),
									confidence: confidence(result.value.confidence),
									compressorTokens: result.tokens,
								};
							},
						};
					}
					if (semanticNodeOptions.rerank) {
						semanticAdapters.reranking = {
							rerank: async (request) => {
								const result = await invokeStructured(semanticSelectionPrompt('rerank', request));
								return {
									rankedIds: stringArray(result.value.rankedIds),
									confidence: confidence(result.value.confidence),
									compressorTokens: result.tokens,
								};
							},
						};
					}
					if (semanticNodeOptions.judge) {
						semanticAdapters.judge = {
							verify: async (request) => {
								const result = await invokeStructured(semanticJudgePrompt(request));
								return {
									meaningPreserved: result.value.meaningPreserved === true,
									missingFacts: stringArray(result.value.missingFacts),
									contradictions: stringArray(result.value.contradictions),
									confidence: confidence(result.value.confidence),
									verificationTokens: result.tokens,
								};
							},
						};
					}
				}

				const result = await optimizeContext(
					{
						systemPrompt: this.getNodeParameter('systemPrompt', itemIndex, ''),
						conversationHistory: this.getNodeParameter('conversationHistory', itemIndex, ''),
						retrievedContext: this.getNodeParameter('retrievedContext', itemIndex, ''),
						toolDefinitions: this.getNodeParameter('toolDefinitions', itemIndex, ''),
						currentMessage: this.getNodeParameter('currentMessage', itemIndex, '') as string,
						protectedValues: this.getNodeParameter('protectedValues', itemIndex, '') as string,
					},
					{
						profile,
						custom,
						qualityLevel,
						semantic: {
							deduplicate: semanticNodeOptions.deduplicate ?? false,
							rerank: semanticNodeOptions.rerank ?? false,
							judge: semanticNodeOptions.judge ?? false,
							minimumConfidence: semanticNodeOptions.minimumConfidence ?? 0.85,
							maximumUnits: semanticNodeOptions.maximumUnits ?? 40,
							maximumSelectedUnits: semanticNodeOptions.maximumSelectedUnits ?? 12,
							tokenBudget: semanticNodeOptions.tokenBudget ?? 4000,
						},
					},
					summaryAdapter,
					semanticAdapters,
				);

				returnData.push({
					json: contextOutput(result, outputDetail) as unknown as IDataObject,
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							optimizedContent: '',
							tokenSavings: {
								before: 0,
								after: 0,
								saved: 0,
								percent: 0,
								measurement: 'unavailable',
								qualityPassed: false,
								fallbackReason: 'node_error',
							},
							error: error instanceof Error ? error.message : String(error),
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw new NodeOperationError(
					this.getNode(),
					error instanceof Error ? error : new Error(String(error)),
					{ itemIndex },
				);
			}
		}

		return [returnData];
	}
}
