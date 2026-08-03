import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type { DetectedContentType } from '../../src/content/types';
import {
	defaultStorageDirectory,
} from '../../src/storage/filesystem-store';
import {
	createConfiguredResourceStore,
	type StorageCredentialValues,
	type StorageProvider,
} from '../../src/storage/configured-store';
import {
	inspectReceipt,
	type OutputDetail,
	storeReceipt,
} from '../../src/output/format-node-output';
import { recordExecutionTelemetry } from '../../src/analytics/execution-telemetry-registry';
import { buildIsolationScope } from '../../src/storage/isolation-scope';
import { testContextSaverStorageApi } from '../../src/storage/credential-test';

type ContextStoreOperation = 'store' | 'inspect' | 'delete' | 'purgeExpired';

function list(value: string): string[] {
	return value
		.split(/\r?\n|,/)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

export class ContextStore implements INodeType {
	methods = { credentialTest: { testContextSaverStorageApi } };

	description: INodeTypeDescription = {
		displayName: 'Context Storage',
		name: 'contextStore',
		icon: {
			light: 'file:context-store.svg',
			dark: 'file:context-store.dark.svg',
		},
		// @ts-expect-error n8n's public type currently omits the supported false value.
		usableAsTool: false,
		group: ['transform'],
		version: [1, 2, 3],
		defaultVersion: 3,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Keep large original data outside the AI prompt so Exact Lookup can recover exact details',
		defaults: { name: 'Context Storage' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
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
				displayName: 'Storage Provider',
				name: 'storageProvider',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Local or Shared Filesystem (Recommended to Start)',
						value: 'filesystem',
						description: 'No credentials; use a shared path when n8n has multiple workers',
						action: 'Store on filesystem',
					},
					{
						name: 'Redis (High Concurrency)',
						value: 'redis',
						description: 'Shared TTL storage for queue mode and many simultaneous sessions',
						action: 'Store in Redis',
					},
				],
				default: 'filesystem',
				displayOptions: { show: { '@version': [3] } },
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Delete Resource',
						value: 'delete',
						description: 'Delete one resource immediately instead of waiting for its TTL',
						action: 'Delete a resource',
					},
					{
						name: 'Inspect Resource',
						value: 'inspect',
						description:
							'Check type, expiry, fields, and record count without loading the original',
						action: 'Inspect a resource',
					},
					{
						name: 'Purge Expired Resources',
						value: 'purgeExpired',
						description: 'Remove every expired resource from this storage directory',
						action: 'Purge expired resources',
					},
					{
						name: 'Store Resource',
						value: 'store',
						description: 'Store an exact gzip-compressed original and return its resource ID',
						action: 'Store a resource',
					},
				],
				default: 'store',
			},
			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				typeOptions: { rows: 8 },
				required: true,
				default: '={{ $json.content || $json.originalContent || "" }}',
				displayOptions: { show: { operation: ['store'] } },
				description: 'Exact original data to keep outside the model prompt',
			},
			{
				displayName: 'Content Type',
				name: 'contentType',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Code', value: 'code' },
					{ name: 'HTML', value: 'html' },
					{ name: 'JSON', value: 'json' },
					{ name: 'Logs', value: 'logs' },
					{ name: 'RAG Documents', value: 'rag' },
					{ name: 'Text', value: 'text' },
					{ name: 'Tool Output', value: 'tool_output' },
				],
				default: 'text',
				displayOptions: { show: { operation: ['store'] } },
			},
			{
				displayName: 'Resource ID',
				name: 'resourceId',
				type: 'string',
				required: true,
				default: '={{ $json.resourceId || "" }}',
				displayOptions: { show: { operation: ['inspect', 'delete'] } },
				description: 'Exact resource ID returned by Store Resource or Content Virtualization',
			},
			{
				displayName: 'Scope',
				name: 'scope',
				type: 'string',
				required: true,
				default: '={{ $workflow.id }}',
				displayOptions: { show: { operation: ['store', 'inspect', 'delete'] } },
				description: 'Workflow isolation key; use the same value in Exact Lookup',
			},
			{
				displayName: 'Session ID',
				name: 'sessionId',
				type: 'string',
				default: '={{ $json.sessionId || $json.sessionKey || "" }}',
				displayOptions: {
					show: { '@version': [3], operation: ['store', 'inspect', 'delete'] },
				},
				description: 'Optional conversation boundary; must match Exact Lookup',
			},
			{
				displayName: 'Owner ID',
				name: 'ownerId',
				type: 'string',
				default: '={{ $json.ownerId || $json.userId || "" }}',
				displayOptions: {
					show: { '@version': [3], operation: ['store', 'inspect', 'delete'] },
				},
				description: 'Optional user or tenant boundary; must match Exact Lookup',
			},
			{
				displayName: 'Fields',
				name: 'fields',
				type: 'string',
				default: '',
				placeholder: 'ID, status, total',
				displayOptions: { show: { operation: ['store'] } },
				description: 'Optional comma-separated schema fields exposed by Inspect Resource',
			},
			{
				displayName: 'Record Count',
				name: 'recordCount',
				type: 'number',
				typeOptions: { minValue: 0, numberPrecision: 0 },
				default: 0,
				displayOptions: { show: { operation: ['store'] } },
				description: 'Optional number of records in the resource; zero omits the value',
			},
			{
				displayName: 'TTL (Hours)',
				name: 'ttlHours',
				type: 'number',
				typeOptions: { minValue: 0.02, maxValue: 8760, numberPrecision: 2 },
				default: 24,
				displayOptions: { show: { operation: ['store'] } },
				description: 'Hours before the stored resource expires',
			},
			{
				displayName: 'Storage Directory',
				name: 'storageDirectory',
				type: 'string',
				default: '',
				placeholder: defaultStorageDirectory(),
				description:
					'Self-hosted storage path; empty uses the n8n user folder and must match the Retriever',
			},
			{
				displayName: 'Redis Key Prefix',
				name: 'redisKeyPrefix',
				type: 'string',
				default: 'context-saver',
				description: 'Namespace used to isolate this package from other Redis data',
				displayOptions: { show: { '@version': [3], storageProvider: ['redis'] } },
			},
			{
				displayName: 'Encrypt Stored Content',
				name: 'encryptStorage',
				type: 'boolean',
				default: false,
				description:
					'Whether to encrypt content with AES-256-GCM using the key in Context Saver Storage API credentials',
				displayOptions: { show: { '@version': [3] } },
			},
			{
				displayName: 'Maximum Resource Size (MB)',
				name: 'maxResourceMegabytes',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 1024, numberPrecision: 0 },
				default: 10,
				displayOptions: { show: { operation: ['store'] } },
				description: 'Reject a larger uncompressed resource instead of filling local storage',
			},
			{
				displayName: 'Allow Secret-Like Content',
				name: 'allowSecretLikeContent',
				type: 'boolean',
				default: false,
				displayOptions: { show: { operation: ['store'] } },
				description:
					'Whether to store content that resembles API keys, passwords, or authorization headers; disabled by default',
			},
			{
				displayName: 'Output',
				name: 'outputDetail',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Simple Receipt (Recommended)',
						value: 'simple',
						description: 'Return only the fields needed by later nodes',
						action: 'Return a simple storage receipt',
					},
					{
						name: 'Detailed Manifest',
						value: 'detailed',
						description: 'Also return hash, byte size, scope, and creation time',
						action: 'Return the detailed storage manifest',
					},
				],
				default: 'simple',
				description: 'The original content is never returned by this node',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const operation = this.getNodeParameter('operation', itemIndex) as ContextStoreOperation;
				const outputDetail = this.getNodeParameter(
					'outputDetail',
					itemIndex,
					'simple',
				) as OutputDetail;
				const configuredDirectory = this.getNodeParameter(
					'storageDirectory',
					itemIndex,
					'',
				) as string;
				const maximumMegabytes = this.getNodeParameter(
					'maxResourceMegabytes',
					itemIndex,
					10,
				) as number;
				const provider = this.getNodeParameter(
					'storageProvider',
					itemIndex,
					'filesystem',
				) as StorageProvider;
				const encryptStorage = this.getNodeParameter(
					'encryptStorage',
					itemIndex,
					false,
				) as boolean;
				let credentials: StorageCredentialValues = {};
				if (this.getNode().typeVersion >= 3 && (provider === 'redis' || encryptStorage)) {
					credentials = (await this.getCredentials(
						'contextSaverStorageApi',
						itemIndex,
					)) as StorageCredentialValues;
				}
				const store = createConfiguredResourceStore({
					provider: this.getNode().typeVersion >= 3 ? provider : 'filesystem',
					directory: configuredDirectory.trim() || defaultStorageDirectory(),
					maxResourceBytes: maximumMegabytes * 1024 * 1024,
					encrypt: this.getNode().typeVersion >= 3 && encryptStorage,
					redisKeyPrefix: this.getNodeParameter(
						'redisKeyPrefix',
						itemIndex,
						'context-saver',
					) as string,
					credentials,
				});
				const scope = buildIsolationScope(
					this.getNodeParameter('scope', itemIndex, this.getWorkflow().id) as string,
					this.getNode().typeVersion >= 3
						? (this.getNodeParameter('sessionId', itemIndex, '') as string)
						: '',
					this.getNode().typeVersion >= 3
						? (this.getNodeParameter('ownerId', itemIndex, '') as string)
						: '',
				);

				let result: IDataObject;
				if (operation === 'store') {
					const recordCount = this.getNodeParameter('recordCount', itemIndex, 0) as number;
					const manifest = await store.store({
						content: this.getNodeParameter('content', itemIndex, '') as string,
						contentType: this.getNodeParameter(
							'contentType',
							itemIndex,
							'text',
						) as DetectedContentType,
						ttlSeconds: (this.getNodeParameter('ttlHours', itemIndex, 24) as number) * 3600,
						scope,
						fields: list(this.getNodeParameter('fields', itemIndex, '') as string),
						...(recordCount > 0 ? { recordCount } : {}),
						allowSecretLikeContent: this.getNodeParameter(
							'allowSecretLikeContent',
							itemIndex,
							false,
						) as boolean,
					});
					result = storeReceipt(manifest) as IDataObject;
					if (outputDetail === 'detailed') {
						result.resource = manifest as unknown as IDataObject;
					}
				} else if (operation === 'inspect') {
					const manifest = await store.inspect(
						this.getNodeParameter('resourceId', itemIndex) as string,
						scope,
					);
					result = inspectReceipt(manifest) as IDataObject;
					if (outputDetail === 'detailed') {
						result.resource = manifest as unknown as IDataObject;
					}
				} else if (operation === 'delete') {
					const resourceId = this.getNodeParameter('resourceId', itemIndex) as string;
					await store.inspect(resourceId, scope);
					result = { resourceId, deleted: await store.delete(resourceId, scope) };
				} else {
					result = { purged: await store.purgeExpired() };
				}

				returnData.push({
					json: result,
					pairedItem: { item: itemIndex },
				});
				recordExecutionTelemetry({
					executionId: this.getExecutionId(),
					nodeName: this.getNode().name,
					component: 'context_storage',
					recordedAt: new Date().toISOString(),
					resourceIds: typeof result.resourceId === 'string' ? [result.resourceId] : [],
					diagnostics: [operation],
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							stored: false,
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
