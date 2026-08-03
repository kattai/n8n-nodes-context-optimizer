import { resolve } from 'node:path';
import type { INodeType, INodeTypeDescription, ISupplyDataFunctions } from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type { CustomProfileConfig, OptimizerProfileName } from '../../src/core/types';
import { isSavingsProfile } from '../../src/core/profiles';
import { recordModelTelemetry } from '../../src/analytics/model-telemetry-registry';
import { extractProviderUsage } from '../../src/analytics/provider-usage';
import {
	defaultFingerprintDirectory,
	FileSystemFingerprintRegistry,
} from '../../src/cache/fingerprint-registry';
import { RedisFingerprintRegistry } from '../../src/cache/redis-fingerprint-registry';
import { resolveNodeCacheStrategy } from '../../src/cache/node-options';
import {
	defaultStorageDirectory,
} from '../../src/storage/filesystem-store';
import {
	createConfiguredResourceStore,
	type StorageCredentialValues,
	type StorageProvider,
} from '../../src/storage/configured-store';
import {
	type ModelOptimizationMetrics,
	wrapLanguageModel,
} from '../../src/model-wrapper/wrap-language-model';
import { buildIsolationScope } from '../../src/storage/isolation-scope';
import { testContextSaverStorageApi } from '../../src/storage/credential-test';

interface MaximumSavingsNodeOptions {
	allowSecretLikeContent?: boolean;
	maxPreviewPercent?: number;
	maxResourceMegabytes?: number;
	minimumContentTokens?: number;
	ownerId?: string;
	scope?: string;
	sessionId?: string;
	storageDirectory?: string;
	targetPreviewPercent?: number;
	ttlHours?: number;
	storageProvider?: StorageProvider;
	redisKeyPrefix?: string;
	encryptStorage?: boolean;
}

interface CacheNodeOptions {
	registryProvider?: 'automatic' | 'filesystem' | 'redis';
	redisKeyPrefix?: string;
	fingerprintDirectory?: string;
	fingerprintTtlHours?: number;
	maximumFingerprints?: number;
	minimumRepetitions?: number;
	minimumStablePrefixTokens?: number;
}

interface ToolSchemaNodeOptions {
	alwaysAvailableTools?: string;
	maximumSelectedTools?: number;
	minimumToolCount?: number;
	selectionMode?: 'automatic' | 'disabled' | 'select_when_safe';
	tokenBudget?: number;
}

function namesList(value: string | undefined): string[] {
	return String(value ?? '')
		.split(/\r?\n|,/)
		.map((entry) => entry.trim())
		.filter(Boolean);
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
	provider: StorageProvider,
	redisKeyPrefix: string,
	encryptStorage: boolean,
): boolean {
	const workflowId = execution.getWorkflow().id ?? 'workflow';
	// n8n's public getChildNodes() currently follows only Main connections.
	// SupplyDataContext exposes the exact Agent parent for AI sub-nodes.
	const parentNode = (execution as unknown as { parentNode?: { name?: string; type?: string } })
		.parentNode;
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
				const retrieverProvider = String(
					retriever.parameters?.storageProvider ?? 'filesystem',
				) as StorageProvider;
				const retrieverPrefix = String(
					retriever.parameters?.redisKeyPrefix ?? 'context-saver',
				);
				const retrieverEncryption = Boolean(retriever.parameters?.encryptStorage ?? false);
				return (
					retrieverScope === scope &&
					retrieverProvider === provider &&
					retrieverEncryption === encryptStorage &&
					(provider === 'redis'
						? retrieverPrefix === redisKeyPrefix
						: retrieverDirectory === normalizedDirectory(directory))
				);
			}),
	);
}

export class OptimizedChatModel implements INodeType {
	methods = { credentialTest: { testContextSaverStorageApi } };

	description: INodeTypeDescription = {
		displayName: 'Agent Optimizer',
		name: 'optimizedChatModel',
		icon: {
			light: 'file:optimized-chat-model.svg',
			dark: 'file:optimized-chat-model.dark.svg',
		},
		// Runtime must stay false: this is an AI model proxy, not an agent-callable tool.
		// @ts-expect-error n8n's public type currently omits the supported false value.
		usableAsTool: false,
		group: ['transform'],
		version: [1, 2, 3],
		defaultVersion: 3,
		subtitle: '={{$parameter["behavior"]}}',
		description:
			'Reduce prompts, history, tool schemas, and tool results before any connected chat model',
		defaults: {
			name: 'Agent Optimizer',
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
		outputNames: ['Optimized Chat Model'],
		credentials: [
			{
				name: 'contextSaverStorageApi',
				required: false,
				testedBy: 'testContextSaverStorageApi',
				displayName: 'Storage and Encryption (Optional)',
				displayOptions: { show: { '@version': [3] } },
			},
		],
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
						description: 'Use only in A/B tests; records usage but sends every message unchanged',
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
						description:
							'Preserve the latest 6 messages and safely compress older repetition and tool results',
						action: 'Balance quality and savings',
					},
					{
						name: 'Maximum Savings',
						value: 'aggressive',
						description:
							'Store large tool results outside the prompt and keep a relevant preview; requires Exact Lookup for exact data',
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
				description:
					'Higher savings levels protect fewer recent messages but never remove unique messages',
				displayOptions: {
					show: { '@version': [1], behavior: ['optimizeAndMeasure'] },
				},
			},
			{
				displayName: 'Profile',
				name: 'profile',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Quality First',
						value: 'quality',
						description:
							'Typical eligible saving: 15–35%. Lossless transforms, 12 recent messages, and exact deduplication only.',
						action: 'Prioritize maximum context fidelity',
					},
					{
						name: 'Balanced (Recommended)',
						value: 'balanced',
						description:
							'Typical eligible saving: 35–60%. Keeps 6 recent messages and uses conservative task-aware selection.',
						action: 'Balance fidelity and savings',
					},
					{
						name: 'Maximum Savings',
						value: 'savings',
						description:
							'Typical eligible saving: 60–85%. Virtualizes large results; connect Exact Lookup for exact details.',
						action: 'Maximize recoverable savings',
					},
					{
						name: 'Custom (Advanced)',
						value: 'custom',
						description:
							'Set recent-message retention and near-duplicate behavior manually for a specialized workflow',
						action: 'Use a custom optimization policy',
					},
				],
				default: 'balanced',
				description:
					'Ranges are typical savings on eligible context, not guarantees for the full request',
				displayOptions: {
					show: { '@version': [2, 3], behavior: ['optimizeAndMeasure'] },
				},
			},
			{
				displayName: 'Adaptive Quality Protection',
				name: 'adaptiveOptimization',
				type: 'boolean',
				default: true,
				description:
					'Whether to automatically use a safer effective profile for code, exact quotes, active tool calls, structured output, or unavailable retrieval',
				displayOptions: {
					show: { '@version': [3], behavior: ['optimizeAndMeasure'] },
				},
			},
			{
				displayName: 'Optimize Repeated Prompt Rules',
				name: 'compileSystemPrompt',
				type: 'boolean',
				default: true,
				description:
					'Whether to remove exact repeated system-prompt blocks while preserving unique rules, code, IDs, numbers, dates, and protected blocks',
				displayOptions: {
					show: { '@version': [3], behavior: ['optimizeAndMeasure'] },
				},
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
						profile: ['aggressive', 'savings'],
					},
				},
				description: 'Defaults target about 80% savings on eligible large tool results',
				options: [
					{
						displayName: 'Allow Secret-Like Content Storage',
						name: 'allowSecretLikeContent',
						type: 'boolean',
						default: false,
						description:
							'Whether to store content that resembles API keys, tokens, passwords, or private keys; leave disabled unless storage is secured',
					},
					{
						displayName: 'Encrypt Stored Content',
						name: 'encryptStorage',
						type: 'boolean',
						default: false,
						description:
							'Whether to use the AES-256-GCM key from Context Saver Storage API credentials',
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
						description:
							'Reject larger uncompressed originals and fall back to structural compression',
					},
					{
						displayName: 'Minimum Content Tokens',
						name: 'minimumContentTokens',
						type: 'number',
						typeOptions: { minValue: 100, maxValue: 1000000, numberPrecision: 0 },
						default: 2000,
						description:
							'Smaller tool results stay inline because storage and retrieval would cost more than they save',
					},
					{
						displayName: 'Owner ID',
						name: 'ownerId',
						type: 'string',
						default: '={{ $json.ownerId || $json.userId || "" }}',
						description: 'Optional user or tenant boundary; must match Exact Lookup',
					},
					{
						displayName: 'Redis Key Prefix',
						name: 'redisKeyPrefix',
						type: 'string',
						default: 'context-saver',
						description: 'Must match Exact Lookup',
						displayOptions: { show: { storageProvider: ['redis'] } },
					},
					{
						displayName: 'Scope',
						name: 'scope',
						type: 'string',
						default: '={{ $workflow.id }}',
						description: 'Workflow isolation key; must match Exact Lookup',
					},
					{
						displayName: 'Session ID',
						name: 'sessionId',
						type: 'string',
						default: '={{ $json.sessionId || $json.sessionKey || "" }}',
						description: 'Optional conversation boundary; must match Exact Lookup',
					},
					{
						displayName: 'Storage Directory',
						name: 'storageDirectory',
						type: 'string',
						default: '',
						placeholder: defaultStorageDirectory(),
						description:
							'Self-hosted path shared with Exact Lookup; queue workers need the same shared directory',
					},
					{
						displayName: 'Storage Provider',
						name: 'storageProvider',
						type: 'options',
						noDataExpression: true,
						options: [
							{
								name: 'Local or Shared Filesystem',
								value: 'filesystem',
								description: 'Zero-credential storage; use shared path for queue workers',
								action: 'Use filesystem storage',
							},
							{
								name: 'Redis (High Concurrency)',
								value: 'redis',
								description: 'Shared TTL storage for many users and queue workers',
								action: 'Use Redis storage',
							},
						],
						default: 'filesystem',
					},
					{
						displayName: 'Target Preview (%)',
						name: 'targetPreviewPercent',
						type: 'number',
						typeOptions: { minValue: 10, maxValue: 30, numberPrecision: 0 },
						default: 20,
						description:
							'Approximate share retained in the prompt; 20% targets about 80% eligible-token savings',
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
				displayName: 'Tool Schema Selection',
				name: 'toolSchemaOptions',
				type: 'collection',
				placeholder: 'Add Setting',
				default: {},
				displayOptions: {
					show: { '@version': [2, 3], behavior: ['optimizeAndMeasure'] },
				},
				description:
					'Reduce schemas sent on each Agent call; low confidence and structured output always keep all tools',
				options: [
					{
						displayName: 'Always Available Tool Names',
						name: 'alwaysAvailableTools',
						type: 'string',
						default: '',
						placeholder: 'search_orders, create_ticket',
						description: 'Comma or newline-separated tool names that selection can never remove',
					},
					{
						displayName: 'Maximum Selected Tools',
						name: 'maximumSelectedTools',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 1000, numberPrecision: 0 },
						default: 6,
						description:
							'Maximum relevant schemas kept inline; required and recently used tools may exceed this safety limit',
					},
					{
						displayName: 'Minimum Tools Before Selection',
						name: 'minimumToolCount',
						type: 'number',
						typeOptions: { minValue: 2, maxValue: 1000, numberPrecision: 0 },
						default: 8,
						description:
							'Smaller tool sets remain complete because selection overhead is not worthwhile',
					},
					{
						displayName: 'Selection Mode',
						name: 'selectionMode',
						type: 'options',
						noDataExpression: true,
						options: [
							{
								name: 'Automatic by Profile (Recommended)',
								value: 'automatic',
								description:
									'Quality and Balanced keep all schemas; Savings selects only when confidence is high',
							},
							{
								name: 'Keep All Tools',
								value: 'disabled',
								description:
									'Disable lazy schemas for workflows where every tool must always be visible',
							},
							{
								name: 'Select Whenever Safe',
								value: 'select_when_safe',
								description:
									'Allow Balanced, Savings, and Custom to select relevant schemas with safe fallback',
							},
						],
						default: 'automatic',
					},
					{
						displayName: 'Tool Schema Token Budget',
						name: 'tokenBudget',
						type: 'number',
						typeOptions: { minValue: 128, maxValue: 1000000, numberPrecision: 0 },
						default: 3000,
						description:
							'Target maximum estimated tokens for selected schemas; mandatory tools remain even if they exceed it',
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
						cacheStrategy: ['automatic_hybrid', 'cache_priority', 'token_reduction_priority'],
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
				description: 'Advanced repetition thresholds for provider-neutral implicit cache detection',
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
						description:
							'Maximum local metadata records before least-recently-seen entries are removed',
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
						description:
							'Ignore cache policy overhead for prefixes too small to provide meaningful savings',
					},
					{
						displayName: 'Redis Key Prefix',
						name: 'redisKeyPrefix',
						type: 'string',
						default: 'context-saver',
						description: 'Namespace for shared cache fingerprints',
					},
					{
						displayName: 'Registry Provider',
						name: 'registryProvider',
						type: 'options',
						noDataExpression: true,
						options: [
							{
								name: 'Automatic (Recommended)',
								value: 'automatic',
								description: 'Use Redis with Redis context storage; otherwise use filesystem',
							},
							{
								name: 'Filesystem',
								value: 'filesystem',
								description: 'Keep fingerprint metadata on this n8n host',
							},
							{
								name: 'Redis',
								value: 'redis',
								description: 'Share cache observations across workers and executions',
							},
						],
						default: 'automatic',
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
						description:
							'Whether to merge near-duplicates when their negation and instruction polarity match',
					},
				],
			},
		],
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<{ response: object }> {
		const model = await this.getInputConnectionData(NodeConnectionTypes.AiLanguageModel, itemIndex);
		if (!model || Array.isArray(model)) {
			throw new NodeOperationError(this.getNode(), 'Connect exactly one chat model', {
				itemIndex,
			});
		}

		const profile = this.getNodeParameter('profile', itemIndex, 'balanced') as OptimizerProfileName;
		const behavior = this.getNodeParameter('behavior', itemIndex, 'optimizeAndMeasure') as
			| 'optimizeAndMeasure'
			| 'measureOnly';
		const adaptiveOptimization = this.getNodeParameter(
			'adaptiveOptimization',
			itemIndex,
			true,
		) as boolean;
		const compileSystemPrompt = this.getNodeParameter(
			'compileSystemPrompt',
			itemIndex,
			true,
		) as boolean;
		const custom = this.getNodeParameter('customProfile', itemIndex, {}) as CustomProfileConfig;
		const maximumSavingsOptions = this.getNodeParameter(
			'maximumSavingsOptions',
			itemIndex,
			{},
		) as MaximumSavingsNodeOptions;
		const cacheOptions = this.getNodeParameter('cacheOptions', itemIndex, {}) as CacheNodeOptions;
		const toolSchemaOptions = this.getNodeParameter(
			'toolSchemaOptions',
			itemIndex,
			{},
		) as ToolSchemaNodeOptions;
		const cacheStrategy = resolveNodeCacheStrategy(
			this.getNode().parameters as Record<string, unknown>,
		);
		const workflowId = this.getWorkflow().id ?? 'workflow';
		const baseScope = connectedScope(maximumSavingsOptions.scope, workflowId) ?? workflowId;
		const scope = buildIsolationScope(
			baseScope,
			maximumSavingsOptions.sessionId,
			maximumSavingsOptions.ownerId,
		);
		const storageDirectory =
			maximumSavingsOptions.storageDirectory?.trim() || defaultStorageDirectory();
		const storageProvider = maximumSavingsOptions.storageProvider ?? 'filesystem';
		const redisKeyPrefix = maximumSavingsOptions.redisKeyPrefix?.trim() || 'context-saver';
		const encryptStorage = maximumSavingsOptions.encryptStorage ?? false;
		const cacheRegistryProvider = cacheOptions.registryProvider ?? 'automatic';
		const useRedisCache =
			this.getNode().typeVersion >= 3 &&
			cacheStrategy !== 'ignore_cache_signals' &&
			(cacheRegistryProvider === 'redis' ||
				(cacheRegistryProvider === 'automatic' && storageProvider === 'redis'));
		const retrieverAvailable =
			isSavingsProfile(profile) &&
			hasCompatibleRetriever(
				this,
				baseScope,
				storageDirectory,
				storageProvider,
				redisKeyPrefix,
				encryptStorage,
			);
		let storageCredentials: StorageCredentialValues = {};
		if (
			this.getNode().typeVersion >= 3 &&
			((isSavingsProfile(profile) && (storageProvider === 'redis' || encryptStorage)) ||
				useRedisCache)
		) {
			storageCredentials = (await this.getCredentials(
				'contextSaverStorageApi',
				itemIndex,
			)) as StorageCredentialValues;
		}
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
		const modelName = (model as { constructor?: { name?: string } }).constructor?.name ?? 'model';
		const cacheScope = `${workflowId}:${this.getNode().name}:${modelName}`;
		const redisUrl = String(storageCredentials.redisUrl ?? '').trim();
		if (useRedisCache && !redisUrl) {
			throw new NodeOperationError(
				this.getNode(),
				'Select Context Saver Storage API credentials with a Redis URL for the cache registry',
				{ itemIndex },
			);
		}
		const cacheRegistry = useRedisCache
			? new RedisFingerprintRegistry(
					{
						url: redisUrl,
						username: String(storageCredentials.redisUsername ?? '').trim() || undefined,
						password: String(storageCredentials.redisPassword ?? '').trim() || undefined,
						keyPrefix: cacheOptions.redisKeyPrefix?.trim() || 'context-saver',
					},
					{ ttlHours: cacheOptions.fingerprintTtlHours ?? 24 },
				)
			: new FileSystemFingerprintRegistry(fingerprintDirectory, {
					ttlHours: cacheOptions.fingerprintTtlHours ?? 24,
					maxEntries: cacheOptions.maximumFingerprints ?? 5000,
				});

		return {
			response: wrapLanguageModel(model as object, {
				profile,
				custom,
				adaptiveOptimization: this.getNode().typeVersion >= 3 ? adaptiveOptimization : false,
				compileSystemPrompt: this.getNode().typeVersion >= 3 ? compileSystemPrompt : false,
				optimizeMessages: behavior !== 'measureOnly',
				...(behavior !== 'measureOnly'
					? {
							...(this.getNode().typeVersion >= 2
								? {
										toolSelection: {
											mode: toolSchemaOptions.selectionMode ?? 'automatic',
											minimumToolCount: toolSchemaOptions.minimumToolCount ?? 8,
											maximumSelectedTools: toolSchemaOptions.maximumSelectedTools ?? 6,
											tokenBudget: toolSchemaOptions.tokenBudget ?? 3000,
											alwaysAvailableTools: namesList(toolSchemaOptions.alwaysAvailableTools),
										},
									}
								: {}),
							cacheAware: {
								strategy: cacheStrategy,
								...(cacheStrategy !== 'ignore_cache_signals'
									? { registry: cacheRegistry }
									: {}),
								scope: cacheScope,
								minimumRepetitions: cacheOptions.minimumRepetitions ?? 2,
								minimumStablePrefixTokens: cacheOptions.minimumStablePrefixTokens ?? 2048,
								registryScope: useRedisCache
									? 'shared_redis'
									: process.env.EXECUTIONS_MODE === 'queue'
										? 'worker_local'
										: 'process_local',
							},
						}
					: {}),
				...(isSavingsProfile(profile) && behavior !== 'measureOnly'
					? {
							maximumSavings: {
								retrieverAvailable,
								store: createConfiguredResourceStore({
									provider:
										this.getNode().typeVersion >= 3 ? storageProvider : 'filesystem',
									directory: storageDirectory,
									maxResourceBytes:
										(maximumSavingsOptions.maxResourceMegabytes ?? 10) * 1024 * 1024,
									encrypt: this.getNode().typeVersion >= 3 && encryptStorage,
									redisKeyPrefix,
									credentials: storageCredentials,
								}),
								scope,
								ttlSeconds: (maximumSavingsOptions.ttlHours ?? 24) * 3600,
								thresholdTokens: maximumSavingsOptions.minimumContentTokens ?? 2000,
								targetPreviewRatio: targetPreviewPercent / 100,
								maxPreviewRatio: maximumPreviewPercent / 100,
								allowSecretLikeContent: maximumSavingsOptions.allowSecretLikeContent ?? false,
							},
						}
					: {}),
				observer: {
					onStart: (metrics: ModelOptimizationMetrics) =>
						this.addInputData(NodeConnectionTypes.AiLanguageModel, [
							[{ json: { optimization: { ...metrics } } }],
						]).index,
					onSuccess: (traceId, response, metrics) => {
						const runIndex = typeof traceId === 'number' ? traceId : this.getNextRunIndex();
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
						const runIndex = typeof traceId === 'number' ? traceId : this.getNextRunIndex();
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
