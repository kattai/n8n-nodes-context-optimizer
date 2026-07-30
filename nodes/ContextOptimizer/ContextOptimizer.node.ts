import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { optimizeContent } from '../../src/content/optimize-content';
import type {
	ContentOptimizationOptions,
	ContentType,
} from '../../src/content/types';
import { optimizeContext } from '../../src/core/optimizer';
import { estimateTokens } from '../../src/core/token-estimator';
import type {
	CustomProfileConfig,
	OptimizerProfileName,
	SummaryAdapter,
	SummaryRequest,
} from '../../src/core/types';
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

type ContextOptimizerOperation =
	| 'buildAgentContext'
	| 'compileStaticPrompt'
	| 'optimizeContent';

interface VirtualizationNodeOptions {
	thresholdTokens?: number;
	maxPreviewTokens?: number;
	maxItems?: number;
	ttlHours?: number;
	scope?: string;
	storageDirectory?: string;
	maxResourceMegabytes?: number;
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
		displayName: 'Token Saver Content',
		name: 'contextOptimizer',
		icon: {
			light: 'file:context-optimizer.svg',
			dark: 'file:context-optimizer.dark.svg',
		},
		// Runtime must stay false: n8n already generates a separate tool variant when true.
		// @ts-expect-error n8n's public type currently omits the supported false value.
		usableAsTool: false,
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"]}}',
		description: 'Compress large data before adding it to an AI prompt; use for JSON, RAG, logs, HTML, or static prompts',
		defaults: {
			name: 'Token Saver Content',
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
						description: 'Use when prompt, history, RAG, and tool definitions are already available as separate fields',
						action: 'Build optimized agent context',
					},
					{
						name: 'Compile Static Prompt',
						value: 'compileStaticPrompt',
						description: 'Use once for a repeated static prompt; returns a smaller stable prompt and hash',
						action: 'Compile a static prompt',
					},
					{
						name: 'Optimize Content',
						value: 'optimizeContent',
						description: 'Use before an agent when one field contains large JSON, logs, HTML, RAG, or tool output',
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
					{ name: 'Auto Detect (Recommended)', value: 'auto', description: 'Choose a safe compressor from the input shape' },
					{ name: 'Code', value: 'code', description: 'Preserve code exactly; only measure its size' },
					{ name: 'HTML', value: 'html', description: 'Remove scripts, styles, navigation, and other page boilerplate' },
					{ name: 'JSON or API Response', value: 'json', description: 'Minify objects and convert repeated records to a shared-schema table' },
					{ name: 'Logs', value: 'logs', description: 'Remove ANSI codes and collapse consecutive identical lines' },
					{ name: 'RAG Documents', value: 'rag', description: 'Remove exactly repeated document chunks' },
					{ name: 'Text', value: 'text', description: 'Normalize formatting and remove exact repeated paragraphs' },
					{ name: 'Tool Output', value: 'tool_output', description: 'Optimize a result that will be returned to an AI Agent' },
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
				description: 'Used only to choose the most relevant preview rows when Context Virtualization is enabled',
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
						description: 'JSON only: remove these top-level fields; excluded data is unavailable unless virtualization stores the original',
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
				description: 'One exact value per line; any missing value makes the node fall back to the original',
			},
			{
				displayName: 'Enable Context Virtualization',
				name: 'enableVirtualization',
				type: 'boolean',
				default: false,
				displayOptions: { show: { operation: ['optimizeContent'] } },
				description:
					'Whether to store large original content and return a smaller preview; connect Token Saver Retriever to the agent',
			},
			{
				displayName: 'Virtualization Options',
				name: 'virtualizationOptions',
				type: 'collection',
				placeholder: 'Add Setting',
				default: {},
				displayOptions: {
					show: {
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
				displayName: 'Optimization Level',
				name: 'profile',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { operation: ['buildAgentContext'] } },
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
						description: 'Control the recent window, token target, and optional unique-content trimming',
						action: 'Optimize context with custom limits',
					},
				],
				default: 'balanced',
				description: 'Default levels never remove unique content merely to meet a token budget',
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
						description: 'Whether to remove older unique history to meet the budget; risky unless the original is retrievable elsewhere',
					},
					{
						displayName: 'Approximate Deduplication',
						name: 'approximateDeduplication',
						type: 'boolean',
						default: true,
						description: 'Whether to merge near-duplicates when negation and instruction polarity match',
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
						description: 'Budget target; unique content remains unless trimming is explicitly allowed below',
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
						description: 'Also return strategies, quality checks, manifests, and virtualization details',
						action: 'Return detailed diagnostics',
					},
				],
				default: 'simple',
				description: 'Simple output prevents the original large value from being passed to the agent by accident',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
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
				const custom = this.getNodeParameter(
					'customProfile',
					itemIndex,
					{},
				) as CustomProfileConfig;

				if (operation === 'compileStaticPrompt' || operation === 'optimizeContent') {
					const content = this.getNodeParameter('content', itemIndex, '') as string;
					const protectedValues = this.getNodeParameter(
						'protectedValues',
						itemIndex,
						'',
					) as string;
					const contentOptions = this.getNodeParameter(
						'contentOptions',
						itemIndex,
						{},
					) as {
						includeFields?: string;
						excludeFields?: string;
						removeNulls?: boolean;
						removeEmptyStrings?: boolean;
					};
					const options: ContentOptimizationOptions = {
						contentType:
							operation === 'compileStaticPrompt'
								? 'text'
								: (this.getNodeParameter(
										'contentType',
										itemIndex,
										'auto',
									) as ContentType),
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
					};
					let result = optimizeContent(content, options);
					let contextVirtualization: Record<string, unknown> = {
						applied: false,
						exactRetrievalRequired: false,
					};
					const enableVirtualization =
						operation === 'optimizeContent' &&
						(this.getNodeParameter(
							'enableVirtualization',
							itemIndex,
							false,
						) as boolean);
					if (enableVirtualization) {
						const virtualizationOptions = this.getNodeParameter(
							'virtualizationOptions',
							itemIndex,
							{},
						) as VirtualizationNodeOptions;
						const thresholdTokens = virtualizationOptions.thresholdTokens ?? 2000;
						if (estimateTokens(result.optimizedContent) > thresholdTokens) {
							try {
								const store = new FileSystemResourceStore(
									virtualizationOptions.storageDirectory?.trim() ||
										defaultStorageDirectory(),
									(virtualizationOptions.maxResourceMegabytes ?? 10) *
										1024 *
										1024,
								);
								const resource = await store.store({
									content,
									contentType: result.contentType,
									ttlSeconds: (virtualizationOptions.ttlHours ?? 24) * 3600,
									scope:
										virtualizationOptions.scope?.trim() ||
										this.getWorkflow().id ||
										'workflow',
									recordCount: result.manifest.recordCount,
									fields: result.manifest.fields,
								});
								const virtualized = virtualizeContext(
									result.optimizedContent,
									result.contentType,
									resource.resourceId,
									{
										thresholdTokens,
										maxPreviewTokens:
											virtualizationOptions.maxPreviewTokens ?? 1500,
										maxItems: virtualizationOptions.maxItems ?? 20,
										currentTask: options.currentTask,
										recordCount: result.manifest.recordCount,
										fields: result.manifest.fields,
									},
								);
								if (
									virtualized.applied &&
									virtualized.previewTokens < result.tokens.optimized
								) {
									const saved = Math.max(
										0,
										result.tokens.original - virtualized.previewTokens,
									);
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
													: Number(
															(
																(saved / result.tokens.original) *
																100
															).toFixed(2),
														),
											areEstimated: true,
										},
										manifest: {
											...result.manifest,
											optimizedBytes: Buffer.byteLength(
												virtualized.content,
											),
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
									contextVirtualization = {
										applied: false,
										exactRetrievalRequired: false,
										fallbackReason: 'no_positive_savings',
									};
								}
							} catch (error) {
								contextVirtualization = {
									applied: false,
									exactRetrievalRequired: false,
									fallbackReason: 'storage_error',
									warning:
										error instanceof Error ? error.message : String(error),
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

				const useSummarizer = this.getNodeParameter(
					'useSummarizer',
					itemIndex,
					false,
				) as boolean;
				const timeoutMs = this.getNodeParameter(
					'summarizerTimeoutMs',
					itemIndex,
					30000,
				) as number;

				let summaryAdapter: SummaryAdapter | undefined;
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
				}

				const result = await optimizeContext(
					{
						systemPrompt: this.getNodeParameter('systemPrompt', itemIndex, ''),
						conversationHistory: this.getNodeParameter(
							'conversationHistory',
							itemIndex,
							'',
						),
						retrievedContext: this.getNodeParameter('retrievedContext', itemIndex, ''),
						toolDefinitions: this.getNodeParameter('toolDefinitions', itemIndex, ''),
						currentMessage: this.getNodeParameter('currentMessage', itemIndex, '') as string,
						protectedValues: this.getNodeParameter('protectedValues', itemIndex, '') as string,
					},
					{ profile, custom },
					summaryAdapter,
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
