import { describe, expect, it } from 'vitest';
import { ContextOptimizer } from '../../nodes/ContextOptimizer/ContextOptimizer.node';
import { ContextMemory } from '../../nodes/ContextMemory/ContextMemory.node';
import {
	ContextRetrieverTool,
	normalizeToolRequest,
} from '../../nodes/ContextRetrieverTool/ContextRetrieverTool.node';
import { ContextStore } from '../../nodes/ContextStore/ContextStore.node';
import { OptimizedChatModel } from '../../nodes/OptimizedChatModel/OptimizedChatModel.node';
import { TokenAnalytics } from '../../nodes/TokenAnalytics/TokenAnalytics.node';
import { resolveNodeCacheStrategy } from '../../src/cache/node-options';

function property(node: { description: { properties: Array<{ name: string }> } }, name: string) {
	return node.description.properties.find((entry) => entry.name === name);
}

function properties(node: { description: { properties: Array<{ name: string }> } }, name: string) {
	return node.description.properties.filter((entry) => entry.name === name);
}

describe('Token Saver node descriptions', () => {
	it('uses one cohesive product name across all six nodes', () => {
		expect(new OptimizedChatModel().description.displayName).toBe('Context Saver Model');
		expect(new ContextOptimizer().description.displayName).toBe('Context Saver Content');
		expect(new ContextStore().description.displayName).toBe('Context Saver Store');
		expect(new ContextRetrieverTool().description.displayName).toBe('Context Saver Retriever');
		expect(new TokenAnalytics().description.displayName).toBe('Context Saver Metrics');
		expect(new ContextMemory().description.displayName).toBe('Context Saver Memory');
	});

	it('defaults the original five nodes to light version 2 while keeping version 1 loadable', () => {
		for (const node of [
			new OptimizedChatModel(),
			new ContextOptimizer(),
			new ContextStore(),
			new ContextRetrieverTool(),
			new TokenAnalytics(),
		]) {
			expect(node.description.version).toEqual([1, 2]);
			expect(node.description.defaultVersion).toBe(2);
		}
		expect(new ContextMemory().description.version).toBe(1);
	});

	it('exposes explicit session operations without pretending to be native agent memory', () => {
		const memory = new ContextMemory();
		const operation = property(memory, 'operation') as {
			options: Array<{ value: string }>;
		};
		expect(operation.options.map((entry) => entry.value)).toEqual([
			'build',
			'delete',
			'inspect',
			'purgeExpired',
			'update',
		]);
		expect(memory.description.inputs).toHaveLength(1);
		expect(memory.description.outputs).toHaveLength(1);
		expect(property(memory, 'recentWindow')).toMatchObject({ default: 6 });
	});

	it('defaults user-facing transform outputs to a simple shape', () => {
		expect(property(new ContextOptimizer(), 'outputDetail')).toMatchObject({ default: 'simple' });
		expect(property(new ContextStore(), 'outputDetail')).toMatchObject({ default: 'simple' });
		expect(property(new TokenAnalytics(), 'outputDetail')).toMatchObject({ default: 'simple' });
	});

	it('lets users price reasoning tokens separately without provider presets', () => {
		expect(property(new TokenAnalytics(), 'reasoningPrice')).toMatchObject({
			type: 'number',
			default: 0,
			displayOptions: { show: { operation: ['estimateCost'] } },
		});
	});

	it('exposes meaningful quality levels and no telemetry-only savings target', () => {
		const chatModel = new OptimizedChatModel();
		const [legacyProfile, profile] = properties(chatModel, 'profile') as Array<{
			options: Array<{ name: string; value: string; description: string }>;
			displayOptions: { show: Record<string, unknown> };
		}>;
		expect(profile.options.map((entry) => entry.name)).toEqual([
			'Quality',
			'Balanced (Recommended)',
			'Savings',
			'Custom (Advanced)',
		]);
		expect(profile.options.every((entry) => entry.description.length > 30)).toBe(true);
		expect(legacyProfile.options.map((entry) => entry.value)).toEqual([
			'safe',
			'balanced',
			'aggressive',
			'custom',
		]);
		expect(profile.options.find((entry) => entry.value === 'savings')?.description).toContain(
			'Context Saver Retriever',
		);
		expect(legacyProfile.displayOptions.show).toMatchObject({ '@version': [1] });
		expect(profile.displayOptions.show).toMatchObject({ '@version': [2] });
		expect(property(chatModel, 'maximumSavingsOptions')).toMatchObject({
			displayOptions: {
				show: { behavior: ['optimizeAndMeasure'], profile: ['aggressive', 'savings'] },
			},
		});
		expect(property(new ContextOptimizer(), 'targetSavingsPercent')).toBeUndefined();
	});

	it('shows the v2 profile for every Content operation and explicit virtualization modes', () => {
		const content = new ContextOptimizer();
		const profile = properties(content, 'profile')[1] as {
			displayOptions: { show: Record<string, unknown> };
			options: Array<{ value: string }>;
		};
		expect(profile.displayOptions.show).toEqual({ '@version': [2] });
		expect(profile.options.map((entry) => entry.value)).toEqual([
			'quality',
			'balanced',
			'savings',
			'custom',
		]);
		expect(property(content, 'virtualizationMode')).toMatchObject({
			default: 'automatic',
			options: [{ value: 'automatic' }, { value: 'disabled' }, { value: 'required' }],
		});
	});

	it('offers cache-aware strategies with progressive disclosure', () => {
		const chatModel = new OptimizedChatModel();
		const strategy = property(chatModel, 'cacheStrategy') as {
			default: string;
			options: Array<{ name: string; value: string; description: string }>;
		};
		expect(strategy.default).toBe('automatic_hybrid');
		expect(strategy.options.map((entry) => entry.value)).toEqual([
			'automatic_hybrid',
			'cache_priority',
			'token_reduction_priority',
			'ignore_cache_signals',
		]);
		expect(strategy.options.every((entry) => entry.description.length > 40)).toBe(true);
		expect(property(chatModel, 'cacheOptions')).toMatchObject({
			type: 'collection',
			displayOptions: { show: { behavior: ['optimizeAndMeasure'] } },
		});
		expect(property(chatModel, 'cachePrivacyNotice')).toMatchObject({ type: 'notice' });
	});

	it('offers safe lazy tool schemas only on the v2 model node', () => {
		const options = property(new OptimizedChatModel(), 'toolSchemaOptions') as {
			displayOptions: { show: Record<string, unknown> };
			options: Array<{ name: string; default: unknown }>;
		};
		expect(options.displayOptions.show).toEqual({
			'@version': [2],
			behavior: ['optimizeAndMeasure'],
		});
		expect(options.options.find((entry) => entry.name === 'selectionMode')).toMatchObject({
			default: 'automatic',
		});
		expect(options.options.find((entry) => entry.name === 'minimumToolCount')).toMatchObject({
			default: 8,
		});
	});

	it('keeps 0.5.2 workflows cache-neutral until the strategy is persisted', () => {
		expect(resolveNodeCacheStrategy({ profile: 'balanced' })).toBe('ignore_cache_signals');
		expect(resolveNodeCacheStrategy({ cacheStrategy: 'automatic_hybrid' })).toBe(
			'automatic_hybrid',
		);
		expect(resolveNodeCacheStrategy({ cacheStrategy: 'invalid' })).toBe('ignore_cache_signals');
	});

	it('supports both legacy supplyData and current n8n AI Tool execution', () => {
		const retriever = new ContextRetrieverTool();
		expect(typeof retriever.supplyData).toBe('function');
		expect(typeof retriever.execute).toBe('function');
	});

	it('infers exact retrieval from provider input that only contains a path', () => {
		expect(
			normalizeToolRequest({
				resourceId: 'ctx_test',
				path: 'records[42]',
			}),
		).toEqual({
			operation: 'get_exact_value',
			resourceId: 'ctx_test',
			path: 'records[42]',
		});
	});

	it('fills workflow-known retrieval defaults when a provider sends empty arguments', () => {
		expect(
			normalizeToolRequest(
				{},
				{
					resourceId: 'ctx_test',
					operation: 'get_exact_value',
					path: 'records[80]',
				},
			),
		).toEqual({
			operation: 'get_exact_value',
			resourceId: 'ctx_test',
			path: 'records[80]',
		});
	});

	it('exposes optional Retriever defaults only in version 2', () => {
		expect(property(new ContextRetrieverTool(), 'toolCallDefaults')).toMatchObject({
			type: 'collection',
			displayOptions: { show: { '@version': [2] } },
		});
	});

	it('keeps semantic adapter calls opt-in and version 2 only', () => {
		const semantic = property(new ContextOptimizer(), 'semanticOptions');
		expect(semantic).toMatchObject({
			type: 'collection',
			displayOptions: { show: { '@version': [2], useSummarizer: [true] } },
		});
		const options = semantic.options as Array<{ name: string; default: unknown }>;
		expect(options.find((entry) => entry.name === 'deduplicate')?.default).toBe(false);
		expect(options.find((entry) => entry.name === 'rerank')?.default).toBe(false);
		expect(options.find((entry) => entry.name === 'judge')?.default).toBe(false);
	});

	it('defaults Context Saver v2 to strict deterministic verification', () => {
		expect(property(new ContextOptimizer(), 'qualityLevel')).toMatchObject({
			default: 'strict',
			displayOptions: { show: { '@version': [2] } },
		});
		expect(property(new ContextMemory(), 'summarySafety')).toMatchObject({
			type: 'collection',
			displayOptions: { show: { operation: ['update'] } },
		});
	});

	it('keeps an explicit retrieval operation when the provider supplies it', () => {
		expect(
			normalizeToolRequest({
				operation: 'filter_records',
				resourceId: 'ctx_test',
				path: 'records',
				filters: { status: 'open' },
			}),
		).toMatchObject({ operation: 'filter_records', filters: { status: 'open' } });
	});

	it('infers compound record filtering without requiring an explicit operation', () => {
		expect(
			normalizeToolRequest({
				resourceId: 'ctx_test',
				path: '$.records',
				where: [{ path: 'total', operator: 'gte', value: 1000 }],
				filterLogic: 'and',
			}),
		).toMatchObject({
			operation: 'filter_records',
			where: [{ path: 'total', operator: 'gte', value: 1000 }],
		});
	});
});
