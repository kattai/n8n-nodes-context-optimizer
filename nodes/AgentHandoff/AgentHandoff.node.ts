import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type { OptimizerProfileName } from '../../src/core/types';
import { buildAgentHandoff } from '../../src/handoff/agent-handoff';
import { recordExecutionTelemetry } from '../../src/analytics/execution-telemetry-registry';

export class AgentHandoff implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Agent Handoff',
		name: 'agentHandoff',
		icon: { light: 'file:agent-handoff.svg', dark: 'file:agent-handoff.dark.svg' },
		// @ts-expect-error n8n's public type currently omits the supported false value.
		usableAsTool: false,
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["profile"]}}',
		description:
			'Pass compact, structured evidence between agents instead of replaying the full previous context',
		defaults: { name: 'Agent Handoff' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'Objective',
				name: 'objective',
				type: 'string',
				typeOptions: { rows: 2 },
				required: true,
				default: '={{ $json.objective || $json.task || $json.chatInput }}',
				description: 'Exact task the next agent must continue',
			},
			{
				displayName: 'Source Agent',
				name: 'fromAgent',
				type: 'string',
				default: '',
				description: 'Optional name of the agent producing this handoff',
			},
			{
				displayName: 'Destination Agent',
				name: 'toAgent',
				type: 'string',
				default: '',
				description: 'Optional name of the agent receiving this handoff',
			},
			{
				displayName: 'Confirmed Facts',
				name: 'confirmedFacts',
				type: 'json',
				default: '={{ $json.confirmedFacts || [] }}',
				description: 'Facts supported by evidence; exact duplicates are removed',
			},
			{
				displayName: 'Decisions',
				name: 'decisions',
				type: 'json',
				default: '={{ $json.decisions || [] }}',
				description: 'Decisions already made that the next agent must not repeat',
			},
			{
				displayName: 'Pending Actions',
				name: 'pendingActions',
				type: 'json',
				default: '={{ $json.pendingActions || [] }}',
				description: 'Unfinished actions and unanswered questions',
			},
			{
				displayName: 'Recoverable Resource IDs',
				name: 'resourceIds',
				type: 'json',
				default: '={{ $json.resourceIds || $json.virtualizedResourceIds || [] }}',
				description: 'Context Storage IDs the next agent can inspect with Exact Lookup',
			},
			{
				displayName: 'Source Output',
				name: 'sourceOutput',
				type: 'json',
				default: '={{ $json.output || $json }}',
				description: 'Previous agent output; deterministic JSON/text compression runs when safe',
			},
			{
				displayName: 'Profile',
				name: 'profile',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Quality First', value: 'quality', description: 'Only exact safe transforms', action: 'Prioritize quality' },
					{ name: 'Balanced (Recommended)', value: 'balanced', description: 'Safe compact handoff for normal chains', action: 'Balance quality and savings' },
					{ name: 'Maximum Savings', value: 'savings', description: 'Stronger structural packing without semantic rewriting', action: 'Maximize handoff savings' },
				],
				default: 'balanced',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const output: INodeExecutionData[] = [];
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const result = buildAgentHandoff({
					objective: this.getNodeParameter('objective', itemIndex) as string,
					fromAgent: this.getNodeParameter('fromAgent', itemIndex, '') as string,
					toAgent: this.getNodeParameter('toAgent', itemIndex, '') as string,
					confirmedFacts: this.getNodeParameter('confirmedFacts', itemIndex, []),
					decisions: this.getNodeParameter('decisions', itemIndex, []),
					pendingActions: this.getNodeParameter('pendingActions', itemIndex, []),
					resourceIds: this.getNodeParameter('resourceIds', itemIndex, []),
					sourceOutput: this.getNodeParameter('sourceOutput', itemIndex, {}),
					profile: this.getNodeParameter('profile', itemIndex, 'balanced') as OptimizerProfileName,
				});
				output.push({
					json: result as unknown as IDataObject,
					pairedItem: { item: itemIndex },
				});
				recordExecutionTelemetry({
					executionId: this.getExecutionId(),
					nodeName: this.getNode().name,
					component: 'agent_handoff',
					recordedAt: new Date().toISOString(),
					tokensBefore: result.receipt.originalTokens,
					tokensAfter: result.receipt.handoffTokens,
					qualityFallbacks: result.receipt.qualityPassed ? 0 : 1,
					selectedProfile: this.getNodeParameter('profile', itemIndex, 'balanced') as string,
					effectiveProfile: this.getNodeParameter('profile', itemIndex, 'balanced') as string,
				});
			} catch (error) {
				throw new NodeOperationError(
					this.getNode(),
					error instanceof Error ? error : new Error(String(error)),
					{ itemIndex },
				);
			}
		}
		return [output];
	}
}
