import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
} from 'n8n-workflow';
import { NodeOperationError, UnexpectedError } from 'n8n-workflow';
import { testContextSaverStorageApi } from '../../src/storage/credential-test';
import { AgentHandoff } from '../AgentHandoff/AgentHandoff.node';
import { ContextMemory } from '../ContextMemory/ContextMemory.node';
import { ContextOptimizer } from '../ContextOptimizer/ContextOptimizer.node';
import { ContextRetrieverTool } from '../ContextRetrieverTool/ContextRetrieverTool.node';
import { ContextStore } from '../ContextStore/ContextStore.node';
import { OptimizedChatModel } from '../OptimizedChatModel/OptimizedChatModel.node';
import { TokenAnalytics } from '../TokenAnalytics/TokenAnalytics.node';

type ContextSaverResource =
	| 'agentHandoff'
	| 'agentModel'
	| 'contextStorage'
	| 'dataOptimization'
	| 'exactLookup'
	| 'savingsReport'
	| 'sessionMemory';

interface SourceNode {
	node: INodeType;
	resource: ContextSaverResource;
	version: number;
}

const sourceNodes: SourceNode[] = [
	{ node: new OptimizedChatModel(), resource: 'agentModel', version: 3 },
	{ node: new ContextOptimizer(), resource: 'dataOptimization', version: 3 },
	{ node: new ContextMemory(), resource: 'sessionMemory', version: 2 },
	{ node: new AgentHandoff(), resource: 'agentHandoff', version: 1 },
	{ node: new ContextStore(), resource: 'contextStorage', version: 3 },
	{ node: new ContextRetrieverTool(), resource: 'exactLookup', version: 3 },
	{ node: new TokenAnalytics(), resource: 'savingsReport', version: 3 },
];

function versionMatches(value: unknown, version: number): boolean {
	return Array.isArray(value) ? value.includes(version) : value === version;
}

function isVisibleAtVersion(property: INodeProperties, version: number): boolean {
	const show = property.displayOptions?.show as Record<string, unknown> | undefined;
	const hide = property.displayOptions?.hide as Record<string, unknown> | undefined;
	if (show?.['@version'] !== undefined && !versionMatches(show['@version'], version)) return false;
	if (hide?.['@version'] !== undefined && versionMatches(hide['@version'], version)) return false;
	return true;
}

function scopeProperty(property: INodeProperties, resource: ContextSaverResource): INodeProperties {
	const originalShow = property.displayOptions?.show as Record<string, unknown> | undefined;
	const originalHide = property.displayOptions?.hide as Record<string, unknown> | undefined;
	const show: Record<string, unknown> = { ...(originalShow ?? {}) };
	const hide: Record<string, unknown> = { ...(originalHide ?? {}) };
	delete show['@version'];
	delete hide['@version'];
	show.resource = [resource];

	return {
		...property,
		displayOptions: {
			show,
			...(Object.keys(hide).length > 0 ? { hide } : {}),
		} as INodeProperties['displayOptions'],
	};
}

const singleOperations: Partial<Record<ContextSaverResource, INodeProperties>> = {
	agentModel: {
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Optimize Agent Model',
				value: 'optimizeAgentModel',
				description: 'Wrap any connected chat model and reduce its input context',
				action: 'Optimize an agent model',
			},
		],
		default: 'optimizeAgentModel',
	},
	agentHandoff: {
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Prepare Agent Handoff',
				value: 'prepareAgentHandoff',
				description: 'Pass compact facts, decisions, and pending work to the next agent',
				action: 'Prepare an agent handoff',
			},
		],
		default: 'prepareAgentHandoff',
	},
	exactLookup: {
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Provide Exact Lookup Tool',
				value: 'provideExactLookup',
				description: 'Give an AI Agent paged access to exact stored context',
				action: 'Provide an exact lookup tool',
			},
		],
		default: 'provideExactLookup',
	},
};

function sourceOperation(source: SourceNode): INodeProperties {
	const operation = source.node.description.properties.find(
		(property) => property.name === 'operation' && isVisibleAtVersion(property, source.version),
	);
	const selected = operation ?? singleOperations[source.resource];
	if (!selected) {
		throw new UnexpectedError(`Context Saver operation is missing for ${source.resource}`);
	}
	return scopeProperty(selected, source.resource);
}

function sourceProperties(source: SourceNode): INodeProperties[] {
	return source.node.description.properties
		.filter((property) => property.name !== 'operation')
		.filter((property) => isVisibleAtVersion(property, source.version))
		.map((property) => scopeProperty(property, source.resource));
}

const resourceOptions: INodeProperties['options'] = [
	{
		name: 'Agent Model',
		value: 'agentModel',
		description: 'Reduce messages sent by an AI Agent to any connected chat model',
	},
	{
		name: 'Data Optimizer',
		value: 'dataOptimization',
		description: 'Compress prompts, JSON, RAG documents, logs, HTML, or tool output',
	},
	{
		name: 'Session Memory',
		value: 'sessionMemory',
		description: 'Keep recent conversation state compact and archive older context',
	},
	{
		name: 'Agent Handoff',
		value: 'agentHandoff',
		description: 'Pass compact facts, decisions, and pending work between agents',
	},
	{
		name: 'Context Storage',
		value: 'contextStorage',
		description: 'Store exact original content outside the model prompt',
	},
	{
		name: 'Exact Lookup',
		value: 'exactLookup',
		description: 'Let an AI Agent retrieve exact stored values only when needed',
	},
	{
		name: 'Savings Report',
		value: 'savingsReport',
		description: 'Measure token reduction, provider usage, and estimated cost',
	},
];

export class ContextSaver implements INodeType {
	methods = { credentialTest: { testContextSaverStorageApi } };

	description: INodeTypeDescription = {
		displayName: 'Context Saver',
		name: 'contextSaver',
		icon: { light: 'file:context-saver.svg', dark: 'file:context-saver.dark.svg' },
		// Runtime must stay false: n8n already generates a separate tool variant when true.
		// @ts-expect-error n8n's public type currently omits the supported false value.
		usableAsTool: false,
		group: ['transform'],
		version: 3,
		subtitle: '={{$parameter["resource"]}}',
		description:
			'Reduce AI input tokens, manage compact memory, store exact context, and measure savings',
		defaults: { name: 'Context Saver' },
		inputs: `={{ (() => {
			const feature = $parameter["resource"];
			if (feature === "agentModel") return [{ type: "ai_languageModel", displayName: "Model", required: true, maxConnections: 1 }];
			if (feature === "exactLookup") return [];
			if (feature === "dataOptimization") return ["main", { type: "ai_languageModel", displayName: "Optional Compression Model", required: false, maxConnections: 1 }];
			return ["main"];
		})() }}`,
		outputs: `={{ (() => {
			const feature = $parameter["resource"];
			if (feature === "agentModel") return [{ type: "ai_languageModel", displayName: "Optimized Chat Model" }];
			if (feature === "exactLookup") return [{ type: "ai_tool", displayName: "Tool" }];
			return ["main"];
		})() }}`,
		credentials: [
			{
				name: 'contextSaverStorageApi',
				required: false,
				testedBy: 'testContextSaverStorageApi',
				displayName: 'Storage and Encryption (Optional)',
				displayOptions: {
					show: {
						resource: [
							'agentModel',
							'dataOptimization',
							'sessionMemory',
							'contextStorage',
							'exactLookup',
						],
					},
				},
			},
		],
		properties: [
			{
				displayName: 'Feature',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: resourceOptions,
				default: 'agentModel',
			},
			...sourceNodes.map(sourceOperation),
			...sourceNodes.flatMap(sourceProperties),
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const resource = this.getNodeParameter('resource', 0, 'agentModel') as ContextSaverResource;

		switch (resource) {
			case 'dataOptimization':
				return await ContextOptimizer.prototype.execute.call(this);
			case 'sessionMemory':
				return await ContextMemory.prototype.execute.call(this);
			case 'agentHandoff':
				return await AgentHandoff.prototype.execute.call(this);
			case 'contextStorage':
				return await ContextStore.prototype.execute.call(this);
			case 'exactLookup':
				return await ContextRetrieverTool.prototype.execute.call(this);
			case 'savingsReport':
				return await TokenAnalytics.prototype.execute.call(this);
			case 'agentModel':
				throw new NodeOperationError(
					this.getNode(),
					'Connect Agent Model to the AI Agent model input instead of the main workflow',
				);
			default:
				throw new NodeOperationError(
					this.getNode(),
					`Unsupported Context Saver feature: ${resource}`,
				);
		}
	}

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const resource = this.getNodeParameter(
			'resource',
			itemIndex,
			'agentModel',
		) as ContextSaverResource;

		if (resource === 'agentModel') {
			return await OptimizedChatModel.prototype.supplyData.call(this, itemIndex);
		}
		if (resource === 'exactLookup') {
			return await ContextRetrieverTool.prototype.supplyData.call(this, itemIndex);
		}
		throw new NodeOperationError(
			this.getNode(),
			`${resource} uses the main workflow connection, not an AI sub-node connection`,
			{ itemIndex },
		);
	}
}
