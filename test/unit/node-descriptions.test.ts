import { describe, expect, it } from 'vitest';
import { ContextOptimizer } from '../../nodes/ContextOptimizer/ContextOptimizer.node';
import {
	ContextRetrieverTool,
	normalizeToolRequest,
} from '../../nodes/ContextRetrieverTool/ContextRetrieverTool.node';
import { ContextStore } from '../../nodes/ContextStore/ContextStore.node';
import { OptimizedChatModel } from '../../nodes/OptimizedChatModel/OptimizedChatModel.node';
import { TokenAnalytics } from '../../nodes/TokenAnalytics/TokenAnalytics.node';

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
});
