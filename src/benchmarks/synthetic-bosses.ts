import { optimizeContext } from '../core/optimizer';
import { buildAgentHandoff } from '../handoff/agent-handoff';
import { selectToolSchemas } from '../tools/tool-schema-selector';

function percent(before: number, after: number): number {
	return before === 0 ? 0 : Number((((before - after) / before) * 100).toFixed(2));
}

function syntheticTools(): unknown[] {
	const names = [
		'calendar_lookup',
		'inventory_search',
		'crm_contact',
		'weather_forecast',
		'invoice_lookup',
		'shipping_quote',
		'knowledge_search',
		'send_email',
		'cancel_order',
		'create_ticket',
		'catalog_search',
		'payment_status',
		'address_validate',
		'return_create',
	];
	const descriptions: Record<string, string> = {
		calendar_lookup: 'Find available calendar meeting dates and time slots tomorrow',
		inventory_search: 'Search fictional product inventory and stock quantities',
		crm_contact: 'Read fictional relationship contact records',
		weather_forecast: 'Get a fictional weather forecast by city and date',
		invoice_lookup: 'Find fictional invoices totals and payment status',
		shipping_quote: 'Calculate fictional freight and delivery price',
		knowledge_search: 'Search fictional internal help articles',
		send_email: 'Send a fictional email message',
		cancel_order: 'Cancel a fictional order by identifier',
		create_ticket: 'Create a fictional support ticket',
		catalog_search: 'Search a fictional catalog',
		payment_status: 'Read fictional payment status',
		address_validate: 'Validate a fictional address',
		return_create: 'Create a fictional return request',
	};
	return names.map((name) => ({
		name,
		description: descriptions[name],
		input_schema: {
			type: 'object',
			properties: Object.fromEntries(
				Array.from({ length: 14 }, (_, index) => [
					`field_${index}`,
					{
						type: 'string',
						description: `Synthetic field ${index} used only by ${name}.`,
					},
				]),
			),
		},
	}));
}

export interface SyntheticBossBenchmarkResult {
	longContext: {
		before: number;
		after: number;
		reductionPercent: number;
		currentMessageExact: boolean;
		protectedFactsExact: boolean;
	};
	toolHeavy: {
		clearIntentReductionPercent: number;
		selectedTools: string[];
		ambiguousKeptAll: boolean;
		ambiguousReason: string;
	};
	multiAgent: {
		before: number;
		after: number;
		reductionPercent: number;
		objectiveExact: boolean;
		factExact: boolean;
	};
	passed: boolean;
}

export async function runSyntheticBossBenchmark(): Promise<SyntheticBossBenchmarkResult> {
	const currentMessage = 'Continue the fictional analysis for exact account SYN-991.';
	const repeatedHistory = Array.from({ length: 220 }, (_, index) =>
		index % 5 === 0
			? 'Repeated synthetic tool result: 200 records checked; no write was performed.'
			: `Synthetic turn ${index % 18}: analysis remains read-only and evidence-linked.`,
	).join('\n');
	const longContext = await optimizeContext(
		{
			systemPrompt:
				'Fictional analytics agent. Preserve SYN-991. Return JSON only. Never perform writes.',
			conversationHistory: repeatedHistory,
			retrievedContext: 'Synthetic snapshot is immutable.\n'.repeat(120),
			currentMessage,
			protectedValues: ['SYN-991'],
		},
		{ profile: 'balanced', qualityLevel: 'strict' },
	);

	const tools = syntheticTools();
	const clear = selectToolSchemas(
		tools,
		[{ role: 'user', content: 'Find available calendar meeting slots tomorrow.' }],
		{
			profile: 'savings',
			mode: 'automatic',
			minimumToolCount: 8,
			maximumSelectedTools: 3,
			tokenBudget: 1800,
		},
	);
	const ambiguous = selectToolSchemas(
		tools,
		[{ role: 'user', content: 'Complete the structured operation.' }],
		{
			profile: 'savings',
			mode: 'automatic',
			minimumToolCount: 8,
			maximumSelectedTools: 3,
			tokenBudget: 1800,
			bindOptions: { tool_choice: 'required', response_format: { type: 'json_schema' } },
		},
	);

	const handoff = buildAgentHandoff({
		objective: 'Resolve exact fictional case SYN-991.',
		fromAgent: 'Synthetic Analyst',
		toAgent: 'Synthetic Resolver',
		confirmedFacts: ['SYN-991 is pending', 'SYN-991 is pending'],
		decisions: ['Use read-only evidence'],
		pendingActions: ['Retrieve exact status'],
		resourceIds: ['ctx_aaaaaaaaaaaaaaaaaaaaaaaa'],
		sourceOutput: Array.from({ length: 180 }, (_, index) => ({
			id: `ROW-${index}`,
			status: index === 91 ? 'pending' : 'reviewed',
			category: `category-${index % 5}`,
			note: 'Generated fictional row for local benchmark only.',
		})),
		profile: 'balanced',
	});
	const parsedHandoff = JSON.parse(handoff.handoffContext) as Record<string, unknown>;

	const result: SyntheticBossBenchmarkResult = {
		longContext: {
			before: longContext.optimization.tokensBefore,
			after: longContext.optimization.tokensAfter,
			reductionPercent: longContext.optimization.savingsPercent,
			currentMessageExact: longContext.currentMessage === currentMessage,
			protectedFactsExact: longContext.optimizedContext.includes('SYN-991'),
		},
		toolHeavy: {
			clearIntentReductionPercent: percent(clear.tokensBefore, clear.tokensAfter),
			selectedTools: clear.selectedNames,
			ambiguousKeptAll: ambiguous.keptAll && ambiguous.tools.length === tools.length,
			ambiguousReason: ambiguous.reason,
		},
		multiAgent: {
			before: handoff.receipt.originalTokens,
			after: handoff.receipt.handoffTokens,
			reductionPercent: handoff.receipt.savedPercent,
			objectiveExact: parsedHandoff.objective === 'Resolve exact fictional case SYN-991.',
			factExact: JSON.stringify(parsedHandoff.confirmedFacts).includes('SYN-991 is pending'),
		},
		passed: false,
	};
	result.passed =
		result.longContext.reductionPercent >= 30 &&
		result.longContext.currentMessageExact &&
		result.longContext.protectedFactsExact &&
		result.toolHeavy.clearIntentReductionPercent >= 60 &&
		result.toolHeavy.selectedTools.includes('calendar_lookup') &&
		result.toolHeavy.ambiguousKeptAll &&
		result.multiAgent.objectiveExact &&
		result.multiAgent.factExact &&
		result.multiAgent.reductionPercent > 0;
	return result;
}
