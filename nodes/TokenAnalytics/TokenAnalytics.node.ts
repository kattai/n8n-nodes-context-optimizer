import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import {
	aggregateMeasurements,
	analyzeTokens,
	compareRuns,
	type RunComparison,
	type TokenAnalysis,
	type TokenPricing,
} from '../../src/analytics/token-analytics';
import { getModelTelemetry } from '../../src/analytics/model-telemetry-registry';
import {
	analysisOutput,
	modelComparisonOutput,
	type OutputDetail,
} from '../../src/output/format-node-output';

type AnalyticsOperation =
	| 'analyze'
	| 'compare'
	| 'compareCurrentExecution'
	| 'aggregate'
	| 'estimateCost';

function parseObject(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return {};
	}
}

export class TokenAnalytics implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Token Savings',
		name: 'tokenAnalytics',
		icon: {
			light: 'file:token-analytics.svg',
			dark: 'file:token-analytics.dark.svg',
		},
		// @ts-expect-error n8n's public type currently omits the supported false value.
		usableAsTool: false,
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Show concise token savings; use after Token Saver nodes or for an A/B model comparison',
		defaults: { name: 'Token Savings' },
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
						name: 'Aggregate Items',
						value: 'aggregate',
						description: 'Combine savings from every incoming item into one total',
						action: 'Aggregate a batch',
					},
					{
						name: 'Analyze Savings',
						value: 'analyze',
						description: 'Use after Token Saver Content or with normalized token fields',
						action: 'Analyze an item',
					},
					{
						name: 'Compare Current Model Calls (A/B)',
						value: 'compareCurrentExecution',
						description:
							'Compare Measure Baseline and Save Tokens wrappers from the same execution',
						action: 'Compare current model calls',
					},
					{
						name: 'Compare Saved Runs',
						value: 'compare',
						description: 'Compare baseline and optimized metrics loaded from previous executions',
						action: 'Compare runs',
					},
					{
						name: 'Estimate Cost',
						value: 'estimateCost',
						description: 'Apply provider prices to token measurements; does not call the provider',
						action: 'Estimate cost',
					},
				],
				default: 'analyze',
			},
			{
				displayName: 'Baseline Model Wrapper',
				name: 'baselineModelNode',
				type: 'string',
				required: true,
				default: 'Measured Chat Model — Baseline',
				displayOptions: { show: { operation: ['compareCurrentExecution'] } },
				description:
					'Exact node name of a Token Saver Chat Model configured as Measure Baseline',
			},
			{
				displayName: 'Optimized Model Wrapper',
				name: 'optimizedModelNode',
				type: 'string',
				required: true,
				default: 'Optimized Chat Model — Balanced',
				displayOptions: { show: { operation: ['compareCurrentExecution'] } },
				description:
					'Exact node name of a Token Saver Chat Model configured as Save Tokens',
			},
			{
				displayName: 'Metrics',
				name: 'metrics',
				type: 'json',
				required: true,
				default: '={{ $json }}',
				displayOptions: { show: { operation: ['analyze', 'estimateCost'] } },
				description:
					'Accepts Token Saver output, model telemetry, or normalized original/sent token fields',
			},
			{
				displayName: 'Baseline Metrics',
				name: 'baselineMetrics',
				type: 'json',
				required: true,
				default: '={{ $json.baseline || {} }}',
				displayOptions: { show: { operation: ['compare'] } },
				description: 'Metrics from the unoptimized baseline',
			},
			{
				displayName: 'Optimized Metrics',
				name: 'optimizedMetrics',
				type: 'json',
				required: true,
				default: '={{ $json.optimized || {} }}',
				displayOptions: { show: { operation: ['compare'] } },
				description: 'Metrics from the optimized run',
			},
			{
				displayName: 'Input Price per 1M Tokens',
				name: 'inputPrice',
				type: 'number',
				typeOptions: { minValue: 0, numberPrecision: 8 },
				default: 0,
				displayOptions: { show: { operation: ['estimateCost'] } },
				description: 'Provider price for one million regular input tokens',
			},
			{
				displayName: 'Cached Input Price per 1M Tokens',
				name: 'cachedInputPrice',
				type: 'number',
				typeOptions: { minValue: 0, numberPrecision: 8 },
				default: 0,
				displayOptions: { show: { operation: ['estimateCost'] } },
				description: 'Provider price for one million cached input tokens',
			},
			{
				displayName: 'Output Price per 1M Tokens',
				name: 'outputPrice',
				type: 'number',
				typeOptions: { minValue: 0, numberPrecision: 8 },
				default: 0,
				displayOptions: { show: { operation: ['estimateCost'] } },
				description: 'Provider price for one million output tokens',
			},
			{
				displayName: 'Currency',
				name: 'currency',
				type: 'string',
				default: 'USD',
				displayOptions: { show: { operation: ['estimateCost'] } },
				description: 'Label used for estimated costs',
			},
			{
				displayName: 'Output',
				name: 'outputDetail',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Simple Summary (Recommended)',
						value: 'simple',
						description: 'Return before, after, saved, percentage, measurement source, and quality',
						action: 'Return a simple savings summary',
					},
					{
						name: 'Detailed Diagnostics',
						value: 'detailed',
						description: 'Also return normalized metrics, provider usage, overhead, rates, and latency',
						action: 'Return detailed token diagnostics',
					},
				],
				default: 'simple',
				description: 'Simple output is intended for normal workflow use',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const operation = this.getNodeParameter('operation', 0) as AnalyticsOperation;
		const outputDetail = this.getNodeParameter(
			'outputDetail',
			0,
			'simple',
		) as OutputDetail;

		try {
			if (operation === 'compareCurrentExecution') {
				const executionId = this.getExecutionId();
				const baselineNodeName = this.getNodeParameter(
					'baselineModelNode',
					0,
				) as string;
				const optimizedNodeName = this.getNodeParameter(
					'optimizedModelNode',
					0,
				) as string;
				const baseline = getModelTelemetry(executionId, baselineNodeName);
				const optimized = getModelTelemetry(executionId, optimizedNodeName);
				if (!baseline || !optimized) {
					const missing = [
						!baseline ? baselineNodeName : undefined,
						!optimized ? optimizedNodeName : undefined,
					].filter((name): name is string => Boolean(name));
					throw new NodeOperationError(
						this.getNode(),
						`Model telemetry not found for this execution: ${missing.join(', ')}`,
					);
				}
				const analytics = compareRuns(baseline, optimized);
				const simple = modelComparisonOutput(analytics);
				return [
					items.map((_, itemIndex) => ({
						json:
							outputDetail === 'detailed'
								? {
										...simple,
										modelTelemetry: {
											baseline,
											optimized,
										} as unknown as IDataObject,
										tokenAnalytics: analytics as unknown as IDataObject,
									}
								: (simple as IDataObject),
						pairedItem: { item: itemIndex },
					})),
				];
			}

			if (operation === 'aggregate') {
				const analytics = aggregateMeasurements(items.map((item) => item.json));
				const simple = analysisOutput(analytics);
				return [
					[
						{
							json: {
								...simple,
								itemsAnalyzed: items.length,
								...(outputDetail === 'detailed'
									? { tokenAnalytics: analytics as unknown as IDataObject }
									: {}),
							},
							pairedItem: items.map((_, item) => ({ item })),
						},
					],
				];
			}

			const returnData: INodeExecutionData[] = [];
			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				let analytics: RunComparison | TokenAnalysis;
				if (operation === 'compare') {
					analytics = compareRuns(
						parseObject(this.getNodeParameter('baselineMetrics', itemIndex)),
						parseObject(this.getNodeParameter('optimizedMetrics', itemIndex)),
					);
				} else {
					const metrics = parseObject(this.getNodeParameter('metrics', itemIndex));
					const pricing: TokenPricing | undefined =
						operation === 'estimateCost'
							? {
									inputPerMillion: this.getNodeParameter(
										'inputPrice',
										itemIndex,
										0,
									) as number,
									cachedInputPerMillion: this.getNodeParameter(
										'cachedInputPrice',
										itemIndex,
										0,
									) as number,
									outputPerMillion: this.getNodeParameter(
										'outputPrice',
										itemIndex,
										0,
									) as number,
									currency: this.getNodeParameter(
										'currency',
										itemIndex,
										'USD',
									) as string,
								}
							: undefined;
					analytics = analyzeTokens(metrics, pricing);
				}
				const simple =
					operation === 'compare'
						? modelComparisonOutput(analytics as RunComparison)
						: analysisOutput(analytics as TokenAnalysis);
				returnData.push({
					json:
						outputDetail === 'detailed'
							? {
									...simple,
									tokenAnalytics: analytics as unknown as IDataObject,
								}
							: (simple as IDataObject),
					pairedItem: { item: itemIndex },
				});
			}
			return [returnData];
		} catch (error) {
			throw new NodeOperationError(
				this.getNode(),
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}
}
