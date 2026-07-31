import { describe, expect, it } from 'vitest';
import { ToolRegistry, toolSchemaName } from '../../src/tools/tool-registry';
import { selectToolSchemas } from '../../src/tools/tool-schema-selector';

function tools() {
	return [
		{ name: 'calendar_lookup', description: 'Find available meeting dates and time slots' },
		{ name: 'inventory_search', description: 'Search product inventory and stock quantities' },
		{ name: 'crm_contact', description: 'Read customer relationship contact records' },
		{ name: 'weather_forecast', description: 'Get weather forecast by city and date' },
		{ name: 'invoice_lookup', description: 'Find invoices, totals, and payment status' },
		{ name: 'shipping_quote', description: 'Calculate freight and delivery price' },
		{ name: 'knowledge_search', description: 'Search internal help center articles' },
		{ name: 'send_email', description: 'Send an email message to one recipient' },
		{ name: 'cancel_order', description: 'Cancel an existing order by identifier' },
		{ name: 'create_ticket', description: 'Create a customer support ticket' },
	];
}

describe('selectToolSchemas', () => {
	it('keeps every tool for the Quality profile', () => {
		const all = tools();
		const selected = selectToolSchemas(all, [{ role: 'user', content: 'Find calendar slots' }], {
			profile: 'quality',
			mode: 'automatic',
			minimumToolCount: 4,
			maximumSelectedTools: 2,
			tokenBudget: 500,
		});

		expect(selected.tools).toEqual(all);
		expect(selected.reason).toBe('quality_profile');
	});

	it('selects relevant tool schemas in Savings without cloning tool objects', () => {
		const all = tools();
		const selected = selectToolSchemas(
			all,
			[{ role: 'user', content: 'Which calendar meeting slots are available tomorrow?' }],
			{
				profile: 'savings',
				mode: 'automatic',
				minimumToolCount: 4,
				maximumSelectedTools: 2,
				tokenBudget: 500,
			},
		);

		expect(selected.keptAll).toBe(false);
		expect(selected.selectedNames).toContain('calendar_lookup');
		expect(selected.tools.length).toBeLessThan(all.length);
		expect(selected.tools[0]).toBe(all.find((tool) => tool.name === selected.selectedNames[0]));
		expect(selected.tokensAfter).toBeLessThan(selected.tokensBefore);
	});

	it('falls back to every tool when lexical confidence is low', () => {
		const all = tools();
		const selected = selectToolSchemas(all, [{ role: 'user', content: 'Please help me.' }], {
			profile: 'savings',
			mode: 'automatic',
			minimumToolCount: 4,
			maximumSelectedTools: 2,
			tokenBudget: 500,
		});

		expect(selected.tools).toEqual(all);
		expect(selected.reason).toBe('low_confidence');
	});

	it('keeps all tools when structured-output binding is ambiguous', () => {
		const all = tools();
		const selected = selectToolSchemas(all, [{ role: 'user', content: 'Find calendar slots' }], {
			profile: 'savings',
			mode: 'automatic',
			minimumToolCount: 4,
			maximumSelectedTools: 2,
			tokenBudget: 500,
			bindOptions: { tool_choice: 'required' },
		});

		expect(selected.tools).toEqual(all);
		expect(selected.reason).toBe('structured_output_ambiguous');
	});

	it('always keeps a tool used in the active conversation', () => {
		const selected = selectToolSchemas(
			tools(),
			[
				{ role: 'assistant', tool_calls: [{ id: 'call-1', name: 'invoice_lookup' }] },
				{ role: 'tool', tool_call_id: 'call-1', content: '{"status":"paid"}' },
				{ role: 'user', content: 'Now find calendar meeting slots.' },
			],
			{
				profile: 'savings',
				mode: 'automatic',
				minimumToolCount: 4,
				maximumSelectedTools: 2,
				tokenBudget: 500,
			},
		);

		expect(selected.selectedNames).toEqual(
			expect.arrayContaining(['calendar_lookup', 'invoice_lookup']),
		);
	});
});

describe('ToolRegistry', () => {
	it('normalizes provider and LangChain tool names and remembers recent use', () => {
		const registry = new ToolRegistry();
		registry.register([
			{ name: 'direct_tool', description: 'Direct' },
			{ type: 'function', function: { name: 'provider_tool', description: 'Provider' } },
		]);
		registry.markUsed(['provider_tool']);

		expect(toolSchemaName({ type: 'function', function: { name: 'provider_tool' } })).toBe(
			'provider_tool',
		);
		expect(registry.recentlyUsed()).toEqual(['provider_tool']);
	});
});
