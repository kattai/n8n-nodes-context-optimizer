import { DynamicStructuredTool } from '@langchain/core/tools';
import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { z } from 'zod';
import {
	retrieveContext,
	type RetrievalPolicy,
	type RetrievalRequest,
	type RetrievalResult,
} from '../../src/retrieval/retrieve-context';
import {
	defaultStorageDirectory,
	FileSystemResourceStore,
} from '../../src/storage/filesystem-store';
import { compactRetrievalResult } from '../../src/output/format-node-output';

function list(value: string): string[] {
	return value
		.split(/\r?\n|,/)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

const resourceId = z.string().min(1).describe('Resource ID returned by Context Store');
const limit = z.number().int().positive().optional().describe('Maximum results requested');
const path = z
	.string()
	.optional()
	.describe('JSON array path, such as orders or data.items');
const operations = [
	'search_context',
	'filter_records',
	'get_exact_value',
	'get_section',
	'inspect_schema',
	'get_original_fragment',
] as const;
const requestSchema = z.discriminatedUnion('operation', [
	z.object({
		operation: z.literal('search_context'),
		resourceId,
		query: z.string().min(1).describe('Terms to locate in the stored resource'),
		limit,
	}),
	z.object({
		operation: z.literal('filter_records'),
		resourceId,
		path,
		filters: z
			.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
			.describe('Required equality filters'),
		fields: z.array(z.string()).optional().describe('Fields to return'),
		limit,
	}),
	z.object({
		operation: z.literal('get_exact_value'),
		resourceId,
		path: z.string().min(1).describe('Exact JSON path, such as orders[28].total'),
	}),
	z.object({
		operation: z.literal('get_section'),
		resourceId,
		section: z.number().int().nonnegative().describe('Zero-based section index'),
	}),
	z.object({
		operation: z.literal('inspect_schema'),
		resourceId,
	}),
	z.object({
		operation: z.literal('get_original_fragment'),
		resourceId,
		start: z.number().int().nonnegative().describe('Fragment start character'),
		end: z.number().int().positive().describe('Fragment end character'),
	}),
]);
const toolInputSchema = z.object({
	operation: z
		.enum(operations)
		.optional()
		.describe('Operation to run; may be inferred from query, filters, path, section, or start/end'),
	resourceId: z
		.string()
		.min(1)
		.optional()
		.describe('Resource ID returned by Token Saver Store or Content'),
	query: z.string().min(1).optional().describe('Terms to locate with search_context'),
	path,
	filters: z
		.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
		.optional()
		.describe('Equality filters used by filter_records'),
	fields: z.array(z.string()).optional().describe('Fields to return from matching records'),
	limit,
	section: z.number().int().nonnegative().optional().describe('Zero-based section index'),
	start: z.number().int().nonnegative().optional().describe('Fragment start character'),
	end: z.number().int().positive().optional().describe('Fragment end character'),
});

export function normalizeToolRequest(value: unknown): RetrievalRequest {
	const input = toolInputSchema.parse(value);
	const operation =
		input.operation ??
		(input.start !== undefined || input.end !== undefined
			? 'get_original_fragment'
			: input.section !== undefined
				? 'get_section'
				: input.filters !== undefined
					? 'filter_records'
					: input.query !== undefined
						? 'search_context'
						: input.path !== undefined
							? 'get_exact_value'
							: 'inspect_schema');
	return requestSchema.parse({ ...input, operation }) as RetrievalRequest;
}

const executionCallCounts = new Map<string, { count: number; updatedAt: number }>();

function nextExecutionCall(executionId: string, nodeName: string): number {
	const now = Date.now();
	for (const [key, state] of executionCallCounts) {
		if (now - state.updatedAt > 60 * 60 * 1000) executionCallCounts.delete(key);
	}
	const key = `${executionId}:${nodeName}`;
	const state = executionCallCounts.get(key) ?? { count: 0, updatedAt: now };
	state.count++;
	state.updatedAt = now;
	executionCallCounts.set(key, state);
	return state.count;
}

export class ContextRetrieverTool implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Token Saver Retriever',
		name: 'contextRetrieverTool',
		icon: {
			light: 'file:context-retriever-tool.svg',
			dark: 'file:context-retriever-tool.dark.svg',
		},
		group: ['transform'],
		version: 1,
		description: 'Let an AI Agent recover exact details from content virtualized outside its prompt',
		defaults: { name: 'Retrieve Exact Context' },
		subtitle: '={{$parameter["scope"]}}',
		inputs: [],
		outputs: [NodeConnectionTypes.AiTool],
		outputNames: ['Tool'],
		properties: [
			{
				displayName: 'Tool Description',
				name: 'toolDescription',
				type: 'string',
				typeOptions: { rows: 4 },
				required: true,
				default:
					'Retrieve an exact missing value or record from a Token Saver resource. Use only when the compact context does not contain the required ID, date, amount, field, or record. Never guess missing data.',
				description: 'Short instruction shown to the agent; keep retrieval rules here instead of the system prompt',
			},
			{
				displayName: 'Scope',
				name: 'scope',
				type: 'string',
				required: true,
				default: '={{ $workflow.id }}',
				description: 'Isolation key; must exactly match Token Saver Store or Content Virtualization',
			},
			{
				displayName: 'Storage Directory',
				name: 'storageDirectory',
				type: 'string',
				default: '',
				placeholder: defaultStorageDirectory(),
				description: 'Self-hosted path; must match the Store or Content Virtualization directory',
			},
			{
				displayName: 'Maximum Results',
				name: 'maxResults',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 1000, numberPrecision: 0 },
				default: 20,
				description: 'Hard cap on records or chunks returned in one tool call',
			},
			{
				displayName: 'Maximum Retrieval Tokens',
				name: 'maxTokens',
				type: 'number',
				typeOptions: { minValue: 50, maxValue: 32000, numberPrecision: 0 },
				default: 4000,
				description: 'Keep tool responses below this estimated size so retrieval does not erase the savings',
			},
			{
				displayName: 'Maximum Calls per Execution',
				name: 'maxCalls',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 100, numberPrecision: 0 },
				default: 5,
				description: 'Stop retrieval loops after this many calls in one agent execution',
			},
			{
				displayName: 'Allowed Fields',
				name: 'allowedFields',
				type: 'string',
				default: '',
				placeholder: 'orderId, status, total',
				description: 'Optional allowlist; leave empty to allow every field not explicitly blocked',
			},
			{
				displayName: 'Blocked Fields',
				name: 'blockedFields',
				type: 'string',
				default: '',
				placeholder: 'secret, password, apiKey',
				description: 'Fields removed recursively from every result, such as passwords or API keys',
			},
			{
				displayName: 'Allow Full Original',
				name: 'allowFullOriginal',
				type: 'boolean',
				default: false,
				description: 'Whether to allow the full original when it is safe and still fits the retrieval token budget',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const directory = this.getNodeParameter('storageDirectory', 0, '') as string;
		const maximumCalls = this.getNodeParameter('maxCalls', 0, 5) as number;
		const policy: RetrievalPolicy = {
			scope: this.getNodeParameter('scope', 0, this.getWorkflow().id) as string,
			maxResults: this.getNodeParameter('maxResults', 0, 20) as number,
			maxTokens: this.getNodeParameter('maxTokens', 0, 4000) as number,
			allowedFields: list(this.getNodeParameter('allowedFields', 0, '') as string),
			blockedFields: list(this.getNodeParameter('blockedFields', 0, '') as string),
			allowFullOriginal: this.getNodeParameter(
				'allowFullOriginal',
				0,
				false,
			) as boolean,
		};
		const store = new FileSystemResourceStore(
			directory.trim() || defaultStorageDirectory(),
		);
		const returnData: INodeExecutionData[] = [];
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const langChainSchema = toolInputSchema as unknown as z.ZodType<unknown>;
				const tool = new DynamicStructuredTool<
					z.ZodType<unknown>,
					unknown,
					unknown,
					string
				>({
					name: 'retrieve_context',
					description: this.getNodeParameter('toolDescription', itemIndex) as string,
					schema: langChainSchema,
					func: async (input) => {
						const request = normalizeToolRequest(input);
						const call = nextExecutionCall(this.getExecutionId(), this.getNode().name);
						const result: RetrievalResult =
							call > maximumCalls
								? {
										ok: false,
										operation: request.operation,
										resourceId: request.resourceId,
										exact: false,
										error: {
											code: 'maximum_calls_exceeded',
											message: `Maximum of ${maximumCalls} retrieval calls exceeded`,
										},
									}
								: await retrieveContext(store, request, policy);
						return JSON.stringify(compactRetrievalResult(result));
					},
				});
				// Current n8n forwards a LangChain ToolCall envelope here. Invoking the
				// tool, instead of parsing item.json directly, unwraps its `args` safely
				// and preserves the tool-call ID in the returned ToolMessage.
				const response = await (
					tool as unknown as { invoke(input: unknown): Promise<unknown> }
				).invoke(items[itemIndex].json);
				returnData.push({
					json: {
						response: response as unknown as IDataObject,
					},
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				throw new NodeOperationError(
					this.getNode(),
					error instanceof Error ? error : new Error(String(error)),
					{ itemIndex },
				);
			}
		}
		return [returnData];
	}

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const directory = this.getNodeParameter('storageDirectory', itemIndex, '') as string;
		const maximumCalls = this.getNodeParameter('maxCalls', itemIndex, 5) as number;
		const policy: RetrievalPolicy = {
			scope: this.getNodeParameter('scope', itemIndex, this.getWorkflow().id) as string,
			maxResults: this.getNodeParameter('maxResults', itemIndex, 20) as number,
			maxTokens: this.getNodeParameter('maxTokens', itemIndex, 4000) as number,
			allowedFields: list(this.getNodeParameter('allowedFields', itemIndex, '') as string),
			blockedFields: list(this.getNodeParameter('blockedFields', itemIndex, '') as string),
			allowFullOriginal: this.getNodeParameter(
				'allowFullOriginal',
				itemIndex,
				false,
			) as boolean,
		};
		const store = new FileSystemResourceStore(
			directory.trim() || defaultStorageDirectory(),
		);
		let callCount = 0;
		const langChainSchema = toolInputSchema as unknown as z.ZodType<unknown>;
		const tool = new DynamicStructuredTool<
			z.ZodType<unknown>,
			unknown,
			unknown,
			string
		>({
			name: 'retrieve_context',
			description: this.getNodeParameter('toolDescription', itemIndex) as string,
			schema: langChainSchema,
			func: async (input) => {
				const request = normalizeToolRequest(input);
				callCount++;
				const trace = this.addInputData(NodeConnectionTypes.AiTool, [
					[
						{
							json: {
								operation: request.operation,
								resourceId: request.resourceId,
								call: callCount,
							},
						},
					],
				]).index;
				const result: RetrievalResult =
					callCount > maximumCalls
						? {
								ok: false,
								operation: request.operation,
								resourceId: request.resourceId,
								exact: false,
								error: {
									code: 'maximum_calls_exceeded',
									message: `Maximum of ${maximumCalls} retrieval calls exceeded`,
								},
							}
						: await retrieveContext(
								store,
								request as RetrievalRequest,
								policy,
							);
				this.addOutputData(NodeConnectionTypes.AiTool, trace, [
					[
						{
							json: {
								ok: result.ok,
								operation: result.operation,
								resourceId: result.resourceId,
								exact: result.exact,
								truncated: result.truncated ?? false,
								tokensEstimated: result.tokensEstimated ?? 0,
								error: result.error as unknown as IDataObject,
							},
						},
					],
				]);
				return JSON.stringify(compactRetrievalResult(result));
			},
		});
		return { response: tool };
	}
}
