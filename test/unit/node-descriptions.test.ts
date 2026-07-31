import { describe, expect, it } from 'vitest';
import { ContextOptimizer } from '../../nodes/ContextOptimizer/ContextOptimizer.node';
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

describe('Token Saver node descriptions', () => {
	it('uses one cohesive product name across all five nodes', () => {
		expect(new OptimizedChatModel().description.displayName).toBe('Token Saver Chat Model');
		expect(new ContextOptimizer().description.displayName).toBe('Token Saver Content');
		expect(new ContextStore().description.displayName).toBe('Token Saver Store');
		expect(new ContextRetrieverTool().description.displayName).toBe('Token Saver Retriever');
		expect(new TokenAnalytics().description.displayName).toBe('Token Savings');
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
		const profile = property(chatModel, 'profile') as {
			options: Array<{ name: string; value: string; description: string }>;
		};
		expect(profile.options.map((entry) => entry.name)).toEqual([
			'Maximum Quality',
			'Balanced (Recommended)',
			'Maximum Savings',
			'Custom (Advanced)',
		]);
		expect(profile.options.every((entry) => entry.description.length > 30)).toBe(true);
		expect(profile.options.find((entry) => entry.value === 'aggressive')?.description).toContain(
			'Token Saver Retriever',
		);
		expect(property(chatModel, 'maximumSavingsOptions')).toMatchObject({
			displayOptions: { show: { behavior: ['optimizeAndMeasure'], profile: ['aggressive'] } },
		});
		expect(property(new ContextOptimizer(), 'targetSavingsPercent')).toBeUndefined();
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
