import { resolve } from 'node:path';
import type { INodeType, INodeTypeDescription, ISupplyDataFunctions } from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type { CustomProfileConfig, OptimizerProfileName } from '../../src/core/types';
import { recordModelTelemetry } from '../../src/analytics/model-telemetry-registry';
import { extractProviderUsage } from '../../src/analytics/provider-usage';
import {
	defaultFingerprintDirectory,
	FileSystemFingerprintRegistry,
} from '../../src/cache/fingerprint-registry';
import { resolveNodeCacheStrategy } from '../../src/cache/node-options';
import {
	defaultStorageDirectory,
	FileSystemResourceStore,
} from '../../src/storage/filesystem-store';
import {
	type ModelOptimizationMetrics,
	wrapLanguageModel,
} from '../../src/model-wrapper/wrap-language-model';

interface MaximumSavingsNodeOptions {
	allowSecretLikeContent?: boolean;
	maxPreviewPercent?: number;
	maxResourceMegabytes?: number;
	minimumContentTokens?: number;
	scope?: string;
	storageDirectory?: string;
	targetPreviewPercent?: number;
	ttlHours?: number;
}

interface CacheNodeOptions {
	fingerprintDirectory?: string;
	fingerprintTtlHours?: number;
	maximumFingerprints?: number;
	minimumRepetitions?: number;
	minimumStablePrefixTokens?: number;
}

function normalizedDirectory(value: string): string {
	return resolve(value.trim() || defaultStorageDirectory()).toLowerCase();
}

function connectedScope(value: unknown, workflowId: string): string | undefined {
	const raw = String(value ?? '').trim();
	if (!raw || raw.includes('$workflow.id')) return workflowId;
	if (raw.startsWith('=')) return undefined;
	return raw;
}

function hasCompatibleRetriever(
	execution: ISupplyDataFunctions,
	scope: string,
	directory: string,
): boolean {
	const workflowId = execution.getWorkflow().id ?? 'workflow';
	// n8n's public getChildNodes() currently follows only Main connections.
	// SupplyDataContext exposes the exact Agent parent for AI sub-nodes.
	const parentNode = (
		execution as unknown as { parentNode?: { name?: string; type?: string } }
	).parentNode;
	const agentNames =
		parentNode?.name && parentNode.type?.includes('n8n-nodes-langchain.agent')
			? [parentNode.name]
			: execution
					.getChildNodes(execution.getNode().name, { includeNodeParameters: true })
					.filter((node) => node.type.includes('n8n-nodes-langchain.agent'))
					.map((node) => node.name);
	return agentNames.some((agentName) =>
		execution
			.getParentNodes(agentName, {
				includeNodeParameters: true,
				connectionType: NodeConnectionTypes.AiTool,
				depth: 1,
			})
			.filter((node) => node.type.endsWith('.contextRetrieverTool'))
			.some((retriever) => {
				const retrieverScope = connectedScope(retriever.parameters?.scope, workflowId);
				const retrieverDirectory = normalizedDirectory(
					String(retriever.parameters?.storageDirectory ?? ''),
				);
				return retrieverScope === scope && retrieverDirectory === normalizedDirectory(directory);
			}),
	);
}

export class OptimizedChatModel implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Token Saver Chat Model',
		name: 'optimizedChatModel',
		icon: {
			light: 'file:optimized-chat-model.svg',
			dark: 'file:optimized-chat-model.dark.svg',
		},
		// Runtime must stay false: this is an AI model proxy, not an agent-callable tool.
		// @ts-expect-error n8n's public type currently omits the supported false value.
		usableAsTool: false,
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["behavior"]}}',
		description: 'Save input tokens before any connected chat model without changing its response',
		defaults: {
			name: 'Token Saver Chat Model',
		},
		inputs: [
			{
				displayName: 'Model',
				type: NodeConnectionTypes.AiLanguageModel,
				required: true,
				maxConnections: 1,
			},
		],
		outputs: [NodeConnectionTypes.AiLanguageModel],
		outputNames: ['Token-Saving Model'],
		properties: [
			{
				displayName: 'Mode',
				name: 'behavior',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Save Tokens',
						value: 'optimizeAndMeasure',
						description: 'Use in production to reduce the messages sent to the connected model',
						action: 'Save tokens on model calls',
					},
					{
						name: 'Measure Baseline',
						value: 'measureOnly',
						description:
							'Use only in A/B tests; records usage but sends every message unchanged',
						action: 'Measure an unoptimized baseline',
					},
				],
				default: 'optimizeAndMeasure',
				description: 'Choose production savings or an unchanged testing baseline',
			},
			{
				displayName: 'Profile',
				name: 'profile',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Maximum Quality',
						value: 'safe',
						description: 'Preserve the latest 12 messages and remove only exact older duplicates',
						action: 'Maximize model quality',
					},
					{
						name: 'Balanced (Recommended)',
						value: 'balanced',
						description: 'Preserve the latest 6 messages and safely compress older repetition and tool results',
						action: 'Balance quality and savings',
					},
					{
						name: 'Maximum Savings',
						value: 'aggressive',
						description: 'Store large tool results outside the prompt and keep a relevant preview; requires Token Saver Retriever for exact data',
						action: 'Maximize token savings',
					},
					{
						name: 'Custom (Advanced)',
						value: 'custom',
						description: 'Set the protected recent window and near-duplicate behavior manually',
						action: 'Optimize model with custom limits',
					},
				],
				default: 'balanced',
				description: 'Higher savings levels protect fewer recent messages but never remove unique messages',
				displayOptions: { show: { behavior: ['optimizeAndMeasure'] } },
			},
			{
				displayName: 'Maximum Savings Options',
				name: 'maximumSavingsOptions',
				type: 'collection',
				placeholder: 'Add Setting',
				default: {},
				displayOptions: {
					show: {
						behavior: ['optimizeAndMeasure'],
						profile: ['aggressive'],
					},
				},
				description: 'Defaults target about 80% savings on eligible large tool results',
				options: [
					{
						displayName: 'Allow Secret-Like Content Storage',
						name: 'allowSecretLikeContent',
						type: 'boolean',
						default: false,
						description: 'Whether to store content that resembles API keys, tokens, passwords, or private keys; leave disabled unless storage is secured',
					},
					{
						displayName: 'Maximum Preview (%)',
						name: 'maxPreviewPercent',
						type: 'number',
						typeOptions: { minValue: 10, maxValue: 30, numberPrecision: 0 },
						default: 30,
						description: 'Hard limit sent inline; 30% means at least 70% eligible-token savings',
					},
					{
						displayName: 'Maximum Resource Size (MB)',
						name: 'maxResourceMegabytes',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 1024, numberPrecision: 0 },
						default: 10,
						description: 'Reject larger uncompressed originals and fall back to structural compression',
					},
					{
						displayName: 'Minimum Content Tokens',
						name: 'minimumContentTokens',
						type: 'number',
						typeOptions: { minValue: 100, maxValue: 1000000, numberPrecision: 0 },
						default: 2000,
						description: 'Smaller tool results stay inline because storage and retrieval would cost more than they save',
					},
					{
						displayName: 'Scope',
						name: 'scope',
						type: 'string',
						default: '={{ $workflow.id }}',
						description: 'Isolation key; must exactly match the Token Saver Retriever connected to the same agent',
					},
					{
						displayName: 'Storage Directory',
						name: 'storageDirectory',
						type: 'string',
						default: '',
						placeholder: defaultStorageDirectory(),
						description: 'Self-hosted path shared with Token Saver Retriever; queue workers need the same shared directory',
					},
					{
						displayName: 'Target Preview (%)',
						name: 'targetPreviewPercent',
						type: 'number',
						typeOptions: { minValue: 10, maxValue: 30, numberPrecision: 0 },
						default: 20,
						description: 'Approximate share retained in the prompt; 20% targets about 80% eligible-token savings',
					},
					{
						displayName: 'TTL (Hours)',
						name: 'ttlHours',
						type: 'number',
						typeOptions: { minValue: 0.02, maxValue: 8760, numberPrecision: 2 },
						default: 24,
						description: 'How long the exact original remains available to the Retriever',
					},
				],
			},
			{
				displayName: 'Cache Strategy',
				name: 'cacheStrategy',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Automatic Hybrid (Recommended)',
						value: 'automatic_hybrid',
						description:
							'Preserve repeated stable prefixes for provider caching and reduce changing content safely',
						action: 'Automatically balance cache and token reduction',
					},
					{
						name: 'Cache Priority',
						value: 'cache_priority',
						description:
							'Favor stable prompt prefixes when provider cache savings matter more than raw input reduction',
						action: 'Prioritize reusable provider cache prefixes',
					},
					{
						name: 'Maximum Token Reduction',
						value: 'token_reduction_priority',
						description:
							'Reduce every eligible block aggressively after preserving mandatory instructions and recent context',
						action: 'Prioritize raw token reduction',
					},
					{
						name: 'Ignore Cache Signals',
						value: 'ignore_cache_signals',
						description:
							'Use only the selected optimization profile and reproduce the cache-neutral behavior from version 0.5.2',
						action: 'Ignore provider cache evidence',
					},
				],
				default: 'automatic_hybrid',
				description:
					'Choose how stable provider-cache prefixes and direct input-token reduction are balanced',
				displayOptions: { show: { behavior: ['optimizeAndMeasure'] } },
			},
			{
				displayName:
					'Fingerprint registry stores only SHA-256 identifiers and timing/count metadata. It never stores prompt text, tool output, secrets, or embeddings.',
				name: 'cachePrivacyNotice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: {
						behavior: ['optimizeAndMeasure'],
						cacheStrategy: [
							'automatic_hybrid',
							'cache_priority',
							'token_reduction_priority',
						],
					},
				},
			},
			{
				displayName: 'Cache-Aware Options',
				name: 'cacheOptions',
				type: 'collection',
				placeholder: 'Add Setting',
				default: {},
				displayOptions: { show: { behavior: ['optimizeAndMeasure'] } },
				description:
					'Advanced repetition thresholds for provider-neutral implicit cache detection',
				options: [
					{
						displayName: 'Fingerprint Directory',
						name: 'fingerprintDirectory',
						type: 'string',
						default: '',
						placeholder: defaultFingerprintDirectory(),
						description:
							'Self-hosted metadata directory; queue workers need the same shared path for account-wide observations',
					},
					{
						displayName: 'Fingerprint TTL (Hours)',
						name: 'fingerprintTtlHours',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 720, numberPrecision: 0 },
						default: 24,
						description: 'Time window in which repeated blocks count as stable cache candidates',
					},
					{
						displayName: 'Maximum Fingerprints',
						name: 'maximumFingerprints',
						type: 'number',
						typeOptions: { minValue: 100, maxValue: 1000000, numberPrecision: 0 },
						default: 5000,
						description: 'Maximum local metadata records before least-recently-seen entries are removed',
					},
					{
						displayName: 'Minimum Repetitions',
						name: 'minimumRepetitions',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 100, numberPrecision: 0 },
						default: 2,
						description: 'Observations required before treating the same large prefix as stable',
					},
					{
						displayName: 'Minimum Stable Prefix Tokens',
						name: 'minimumStablePrefixTokens',
						type: 'number',
						typeOptions: { minValue: 128, maxValue: 1000000, numberPrecision: 0 },
						default: 2048,
						description: 'Ignore cache policy overhead for prefixes too small to provide meaningful savings',
					},
				],
			},
			{
				displayName: 'Custom Profile',
				name: 'customProfile',
				type: 'collection',
				placeholder: 'Add Setting',
				default: {},
				displayOptions: {
					show: {
						behavior: ['optimizeAndMeasure'],
						profile: ['custom'],
					},
				},
				options: [
					{
						displayName: 'Keep Recent Messages',
						name: 'keepRecentMessages',
						type: 'number',
						typeOptions: { minValue: 0, numberPrecision: 0 },
						default: 6,
						description: 'Messages at the end of the conversation kept exactly as received',
					},
					{
						displayName: 'Approximate Deduplication',
						name: 'approximateDeduplication',
						type: 'boolean',
						default: false,
						description: 'Whether to merge near-duplicates when their negation and instruction polarity match',
					},
				],
			},
		],
	};

	async supplyData(
		this: ISupplyDataFunctions,
		itemIndex: number,
	): Promise<{ response: object }> {
		const model = await this.getInputConnectionData(
			NodeConnectionTypes.AiLanguageModel,
			itemIndex,
		);
		if (!model || Array.isArray(model)) {
			throw new NodeOperationError(this.getNode(), 'Connect exactly one chat model', {
				itemIndex,
			});
		}

		const profile = this.getNodeParameter(
			'profile',
			itemIndex,
			'balanced',
		) as OptimizerProfileName;
		const behavior = this.getNodeParameter(
			'behavior',
			itemIndex,
			'optimizeAndMeasure',
		) as 'optimizeAndMeasure' | 'measureOnly';
		const custom = this.getNodeParameter(
			'customProfile',
			itemIndex,
			{},
		) as CustomProfileConfig;
		const maximumSavingsOptions = this.getNodeParameter(
			'maximumSavingsOptions',
			itemIndex,
			{},
		) as MaximumSavingsNodeOptions;
		const cacheOptions = this.getNodeParameter(
			'cacheOptions',
			itemIndex,
			{},
		) as CacheNodeOptions;
		const cacheStrategy = resolveNodeCacheStrategy(
			this.getNode().parameters as Record<string, unknown>,
		);
		const workflowId = this.getWorkflow().id ?? 'workflow';
		const scope =
			connectedScope(maximumSavingsOptions.scope, workflowId) ?? workflowId;
		const storageDirectory =
			maximumSavingsOptions.storageDirectory?.trim() || defaultStorageDirectory();
		const retrieverAvailable =
			profile === 'aggressive' &&
			hasCompatibleRetriever(this, scope, storageDirectory);
		const maximumPreviewPercent = Math.min(
			30,
			Math.max(10, maximumSavingsOptions.maxPreviewPercent ?? 30),
		);
		const targetPreviewPercent = Math.min(
			maximumPreviewPercent,
			Math.max(10, maximumSavingsOptions.targetPreviewPercent ?? 20),
		);
		const fingerprintDirectory =
			cacheOptions.fingerprintDirectory?.trim() || defaultFingerprintDirectory();
		const modelName =
			(model as { constructor?: { name?: string } }).constructor?.name ?? 'model';
		const cacheScope = `${workflowId}:${this.getNode().name}:${modelName}`;

		return {
			response: wrapLanguageModel(model as object, {
				profile,
				custom,
				optimizeMessages: behavior !== 'measureOnly',
				...(behavior !== 'measureOnly'
					? {
							cacheAware: {
								strategy: cacheStrategy,
								...(cacheStrategy !== 'ignore_cache_signals'
									? {
											registry: new FileSystemFingerprintRegistry(
												fingerprintDirectory,
												{
													ttlHours: cacheOptions.fingerprintTtlHours ?? 24,
													maxEntries: cacheOptions.maximumFingerprints ?? 5000,
												},
											),
										}
									: {}),
								scope: cacheScope,
								minimumRepetitions: cacheOptions.minimumRepetitions ?? 2,
								minimumStablePrefixTokens:
									cacheOptions.minimumStablePrefixTokens ?? 2048,
								registryScope:
									process.env.EXECUTIONS_MODE === 'queue'
										? 'worker_local'
										: 'process_local',
							},
						}
					: {}),
				...(profile === 'aggressive' && behavior !== 'measureOnly'
					? {
							maximumSavings: {
								retrieverAvailable,
								store: new FileSystemResourceStore(
									storageDirectory,
									(maximumSavingsOptions.maxResourceMegabytes ?? 10) * 1024 * 1024,
								),
								scope,
								ttlSeconds: (maximumSavingsOptions.ttlHours ?? 24) * 3600,
								thresholdTokens: maximumSavingsOptions.minimumContentTokens ?? 2000,
								targetPreviewRatio: targetPreviewPercent / 100,
								maxPreviewRatio: maximumPreviewPercent / 100,
								allowSecretLikeContent:
									maximumSavingsOptions.allowSecretLikeContent ?? false,
							},
						}
					: {}),
				observer: {
					onStart: (metrics: ModelOptimizationMetrics) =>
						this.addInputData(NodeConnectionTypes.AiLanguageModel, [
							[{ json: { optimization: { ...metrics } } }],
						]).index,
					onSuccess: (traceId, response, metrics) => {
						const runIndex =
							typeof traceId === 'number' ? traceId : this.getNextRunIndex();
						const usage = extractProviderUsage(response);
						this.addOutputData(NodeConnectionTypes.AiLanguageModel, runIndex, [
							[
								{
									json: {
										optimization: { ...metrics },
										providerUsage: usage,
									},
								},
							],
						]);
						recordModelTelemetry({
							executionId: this.getExecutionId(),
							nodeName: this.getNode().name,
							recordedAt: new Date().toISOString(),
							optimization: metrics,
							providerUsage: usage,
						});
					},
					onError: (traceId, error) => {
						const runIndex =
							typeof traceId === 'number' ? traceId : this.getNextRunIndex();
						this.addOutputData(
							NodeConnectionTypes.AiLanguageModel,
							runIndex,
							new NodeOperationError(
								this.getNode(),
								error instanceof Error ? error : new Error(String(error)),
								{ itemIndex },
							),
						);
					},
				},
			}),
		};
	}
}
