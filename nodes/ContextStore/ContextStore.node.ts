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
	FileSystemResourceStore,
} from '../../src/storage/filesystem-store';
import {
	inspectReceipt,
	type OutputDetail,
	storeReceipt,
} from '../../src/output/format-node-output';

type ContextStoreOperation = 'store' | 'inspect' | 'delete' | 'purgeExpired';

function list(value: string): string[] {
	return value
		.split(/\r?\n|,/)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

export class ContextStore implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Token Saver Store',
		name: 'contextStore',
		icon: {
			light: 'file:context-store.svg',
			dark: 'file:context-store.dark.svg',
		},
		// @ts-expect-error n8n's public type currently omits the supported false value.
		usableAsTool: false,
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Keep large original data outside the AI prompt so Token Saver Retriever can recover exact details',
		defaults: { name: 'Token Saver Store' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
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
				description: 'Isolation key; use the same value in Token Saver Retriever',
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
				const store = new FileSystemResourceStore(
					configuredDirectory.trim() || defaultStorageDirectory(),
					maximumMegabytes * 1024 * 1024,
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
						scope: this.getNodeParameter('scope', itemIndex, this.getWorkflow().id) as string,
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
					const scope = this.getNodeParameter('scope', itemIndex, this.getWorkflow().id) as string;
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
					const scope = this.getNodeParameter('scope', itemIndex, this.getWorkflow().id) as string;
					await store.inspect(resourceId, scope);
					result = { resourceId, deleted: await store.delete(resourceId, scope) };
				} else {
					result = { purged: await store.purgeExpired() };
				}

				returnData.push({
					json: result,
					pairedItem: { item: itemIndex },
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
