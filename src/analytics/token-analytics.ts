export interface TokenMeasurement {
	original: number;
	sent: number;
	compressor: number;
	retrieved: number;
	verifier: number;
	output: number;
	cached: number;
	reasoning: number;
	actualInput: number;
	actualOutput: number;
	actualTotal: number;
	providerUsageAvailable: boolean;
	cacheUsageAvailable: boolean;
	latencyMs: number;
	fallbacks: number;
	qualityGuardFailures: number;
	retrievalCalls: number;
	stablePrefixTokens: number;
	dynamicTokensBefore: number;
	dynamicTokensAfter: number;
	profile?: string;
	cacheStrategy?: string;
	cacheDecision?: string;
	strategies: string[];
}

export interface TokenPricing {
	inputPerMillion: number;
	cachedInputPerMillion: number;
	outputPerMillion: number;
	reasoningPerMillion?: number;
	currency: string;
}

export interface TokenAnalysis {
	measurement: TokenMeasurement;
	savings: {
		grossTokens: number;
		netTokens: number;
		grossPercent: number;
		netPercent: number;
		positive: boolean;
	};
	rates: {
		retrievalPercent: number;
		cacheHitPercent: number;
	};
	actual: {
		available: boolean;
		inputTokens: number;
		regularInputTokens: number;
		cachedInputTokens: number;
		outputTokens: number;
		reasoningTokens: number;
		totalTokens: number;
		billableOutputTokens: number;
		cacheUsageAvailable: boolean;
	};
	measurementConfidence: 'provider_actual' | 'provider_partial' | 'optimizer_estimate';
	cost?: {
		before: number;
		after: number;
		saved: number;
		savedPercent: number;
		currency: string;
		estimated: true;
		inputBasis: 'provider-actual' | 'optimizer-estimate';
	};
}

export interface RunComparison {
	baseline: TokenAnalysis;
	optimized: TokenAnalysis;
	delta: {
		inputTokens: number;
		netTokens: number;
		latencyMs: number;
		fallbacks: number;
		qualityGuardFailures: number;
		cost?: number;
		inputTokenBasis: 'provider-actual' | 'optimizer-estimate';
	};
}

function finite(value: unknown): number {
	const number = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function percent(numerator: number, denominator: number): number {
	return denominator === 0
		? 0
		: Number(((numerator / denominator) * 100).toFixed(2));
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function nested(root: Record<string, unknown>, ...paths: string[]): unknown {
	for (const path of paths) {
		let value: unknown = root;
		for (const segment of path.split('.')) {
			value = record(value)[segment];
		}
		if (value !== undefined && value !== null && value !== '') return value;
	}
	return undefined;
}

function hasNested(root: Record<string, unknown>, path: string): boolean {
	let value: unknown = root;
	for (const segment of path.split('.')) {
		const current = record(value);
		if (!Object.prototype.hasOwnProperty.call(current, segment)) return false;
		value = current[segment];
	}
	return value !== undefined && value !== null;
}

function stringList(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(String).map((entry) => entry.trim()).filter(Boolean);
	if (typeof value !== 'string') return [];
	return value
		.split(/\r?\n|,/)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

export function normalizeMeasurement(value: unknown): TokenMeasurement {
	const root = record(value);
	const metrics = record(root.measurement ?? root.tokenAnalytics ?? root);
	const simpleQualityPassed = nested(metrics, 'tokenSavings.qualityPassed', 'qualityPassed');
	const qualityGuardFailures = nested(
		metrics,
		'qualityGuardFailures',
		'quality.failures',
		'qualityGuard.failed',
	);
	const cacheUsageAvailable = [
		'cached',
		'tokens.cached',
		'cachedInputTokens',
		'providerUsage.cachedInputTokens',
	].some((path) => hasNested(metrics, path));
	return {
		original: finite(
			nested(
				metrics,
				'original',
				'before',
				'tokens.original',
				'tokensBefore',
				'tokensBeforeEstimated',
				'tokenSavings.before',
				'optimization.tokensBefore',
				'contentOptimization.tokens.original',
				'contentOptimization.tokens.before',
			),
		),
		sent: finite(
			nested(
				metrics,
				'sent',
				'after',
				'tokens.sent',
				'tokensAfter',
				'tokensAfterEstimated',
				'tokenSavings.after',
				'optimization.tokensAfter',
				'contentOptimization.tokens.optimized',
				'contentOptimization.tokens.after',
			),
		),
		compressor: finite(nested(metrics, 'compressor', 'tokens.compressor', 'compressorTokens')),
		retrieved: finite(nested(metrics, 'retrieved', 'tokens.retrieved', 'retrievedTokens')),
		verifier: finite(nested(metrics, 'verifier', 'tokens.verifier', 'verifierTokens')),
		output: finite(
			nested(metrics, 'output', 'tokens.output', 'outputTokens', 'providerUsage.outputTokens'),
		),
		cached: finite(
			nested(
				metrics,
				'cached',
				'tokens.cached',
				'cachedInputTokens',
				'providerUsage.cachedInputTokens',
			),
		),
		reasoning: finite(
			nested(
				metrics,
				'reasoning',
				'tokens.reasoning',
				'reasoningTokens',
				'providerUsage.reasoningTokens',
			),
		),
		actualInput: finite(
			nested(
				metrics,
				'actualInput',
				'actual.inputTokens',
				'providerUsage.inputTokens',
			),
		),
		actualOutput: finite(
			nested(
				metrics,
				'actualOutput',
				'actual.outputTokens',
				'providerUsage.outputTokens',
			),
		),
		actualTotal: finite(
			nested(
				metrics,
				'actualTotal',
				'actual.totalTokens',
				'providerUsage.totalTokens',
			),
		),
		providerUsageAvailable: Boolean(
			nested(metrics, 'providerUsageAvailable', 'actual.available', 'providerUsage.available'),
		),
		cacheUsageAvailable,
		latencyMs: finite(
			nested(metrics, 'latencyMs', 'durationMs', 'optimization.durationMs', 'metrics.durationMs'),
		),
		fallbacks: finite(
			nested(metrics, 'fallbacks', 'fallbackCount', 'optimization.fallback'),
		),
		qualityGuardFailures:
			qualityGuardFailures !== undefined
				? finite(qualityGuardFailures)
				: simpleQualityPassed === false
					? 1
					: 0,
		retrievalCalls: finite(
			nested(metrics, 'retrievalCalls', 'retrieval.calls', 'toolCalls.retrieval'),
		),
		stablePrefixTokens: finite(
			nested(metrics, 'stablePrefixTokens', 'optimization.stablePrefixTokens'),
		),
		dynamicTokensBefore: finite(
			nested(metrics, 'dynamicTokensBefore', 'optimization.dynamicTokensBefore'),
		),
		dynamicTokensAfter: finite(
			nested(metrics, 'dynamicTokensAfter', 'optimization.dynamicTokensAfter'),
		),
		profile: String(nested(metrics, 'profile', 'optimization.profile') ?? '').trim() || undefined,
		cacheStrategy:
			String(nested(metrics, 'cacheStrategy', 'optimization.cacheStrategy') ?? '').trim() ||
			undefined,
		cacheDecision:
			String(nested(metrics, 'cacheDecision', 'optimization.cacheDecision') ?? '').trim() ||
			undefined,
		strategies: stringList(
			nested(metrics, 'strategies', 'strategyUsed', 'contentOptimization.strategies'),
		),
	};
}

export function analyzeTokens(
	measurementInput: TokenMeasurement | unknown,
	pricing?: TokenPricing,
): TokenAnalysis {
	const measurement = normalizeMeasurement(measurementInput);
	const grossTokens = measurement.original - measurement.sent;
	const overhead = measurement.compressor + measurement.retrieved + measurement.verifier;
	const netTokens = grossTokens - overhead;
	const actualAvailable =
		measurement.providerUsageAvailable ||
		measurement.actualInput > 0 ||
		measurement.actualOutput > 0 ||
		measurement.actualTotal > 0;
	const reasoningOutsideOutput = Math.max(
		0,
		measurement.actualTotal - measurement.actualInput - measurement.actualOutput,
	);
	const billableOutputTokens = actualAvailable
		? measurement.actualOutput + reasoningOutsideOutput
		: measurement.output;
	const cachedInputTokens = Math.min(
		measurement.cached,
		actualAvailable ? measurement.actualInput : measurement.sent,
	);
	const regularInputTokens = Math.max(
		0,
		(actualAvailable ? measurement.actualInput : measurement.sent) - cachedInputTokens,
	);
	const measurementConfidence = actualAvailable
		? measurement.cacheUsageAvailable
			? 'provider_actual'
			: 'provider_partial'
		: 'optimizer_estimate';
	const result: TokenAnalysis = {
		measurement,
		savings: {
			grossTokens,
			netTokens,
			grossPercent: percent(grossTokens, measurement.original),
			netPercent: percent(netTokens, measurement.original),
			positive: netTokens > 0,
		},
		rates: {
			retrievalPercent: percent(measurement.retrieved, measurement.original),
			cacheHitPercent: percent(
				Math.min(measurement.cached, measurement.sent),
				measurement.sent,
			),
		},
		actual: {
			available: actualAvailable,
			inputTokens: measurement.actualInput,
			regularInputTokens,
			cachedInputTokens,
			outputTokens: measurement.actualOutput,
			reasoningTokens: measurement.reasoning,
			totalTokens: measurement.actualTotal,
			billableOutputTokens,
			cacheUsageAvailable: actualAvailable && measurement.cacheUsageAvailable,
		},
		measurementConfidence,
	};

	const pricingConfigured =
		pricing &&
		[
			pricing.inputPerMillion,
			pricing.cachedInputPerMillion,
			pricing.outputPerMillion,
			pricing.reasoningPerMillion ?? 0,
		].some((price) => Number.isFinite(price) && price > 0);
	if (pricing && pricingConfigured) {
		const sentForCost = actualAvailable ? measurement.actualInput : measurement.sent;
		const cached = Math.min(measurement.cached, sentForCost);
		const regularInput = Math.max(0, sentForCost - cached);
		const extraInput = measurement.compressor + measurement.retrieved + measurement.verifier;
		const reasoningTokens = Math.max(measurement.reasoning, reasoningOutsideOutput);
		const reasoningIncludedInOutput = Math.max(0, reasoningTokens - reasoningOutsideOutput);
		const regularOutputTokens = Math.max(
			0,
			(actualAvailable ? measurement.actualOutput : measurement.output) -
				reasoningIncludedInOutput,
		);
		const outputCost =
			pricing.reasoningPerMillion !== undefined
				? (regularOutputTokens / 1_000_000) * pricing.outputPerMillion +
					(reasoningTokens / 1_000_000) * pricing.reasoningPerMillion
				: (billableOutputTokens / 1_000_000) * pricing.outputPerMillion;
		const before =
			(measurement.original / 1_000_000) * pricing.inputPerMillion +
			outputCost;
		const after =
			(regularInput / 1_000_000) * pricing.inputPerMillion +
			(cached / 1_000_000) * pricing.cachedInputPerMillion +
			(extraInput / 1_000_000) * pricing.inputPerMillion +
			outputCost;
		const saved = before - after;
		result.cost = {
			before: Number(before.toFixed(8)),
			after: Number(after.toFixed(8)),
			saved: Number(saved.toFixed(8)),
			savedPercent: percent(saved, before),
			currency: pricing.currency,
			estimated: true,
			inputBasis: actualAvailable ? 'provider-actual' : 'optimizer-estimate',
		};
	}
	return result;
}

export function aggregateMeasurements(values: unknown[]): TokenAnalysis {
	const measurements = values.map(normalizeMeasurement);
	const aggregate: TokenMeasurement = {
		original: 0,
		sent: 0,
		compressor: 0,
		retrieved: 0,
		verifier: 0,
		output: 0,
		cached: 0,
		reasoning: 0,
		actualInput: 0,
		actualOutput: 0,
		actualTotal: 0,
		providerUsageAvailable: false,
		cacheUsageAvailable: false,
		latencyMs: 0,
		fallbacks: 0,
		qualityGuardFailures: 0,
		retrievalCalls: 0,
		stablePrefixTokens: 0,
		dynamicTokensBefore: 0,
		dynamicTokensAfter: 0,
		strategies: [],
	};
	const profiles = new Set<string>();
	const strategies = new Set<string>();
	const cacheStrategies = new Set<string>();
	const cacheDecisions = new Set<string>();
	for (const measurement of measurements) {
		for (const key of [
			'original',
			'sent',
			'compressor',
			'retrieved',
			'verifier',
			'output',
			'cached',
			'reasoning',
			'actualInput',
			'actualOutput',
			'actualTotal',
			'latencyMs',
			'fallbacks',
			'qualityGuardFailures',
			'retrievalCalls',
			'stablePrefixTokens',
			'dynamicTokensBefore',
			'dynamicTokensAfter',
		] as const) {
			aggregate[key] += measurement[key];
		}
		aggregate.providerUsageAvailable ||= measurement.providerUsageAvailable;
		aggregate.cacheUsageAvailable ||= measurement.cacheUsageAvailable;
		if (measurement.profile) profiles.add(measurement.profile);
		if (measurement.cacheStrategy) cacheStrategies.add(measurement.cacheStrategy);
		if (measurement.cacheDecision) cacheDecisions.add(measurement.cacheDecision);
		for (const strategy of measurement.strategies) strategies.add(strategy);
	}
	aggregate.profile = profiles.size === 1 ? [...profiles][0] : profiles.size > 1 ? 'mixed' : undefined;
	aggregate.cacheStrategy =
		cacheStrategies.size === 1
			? [...cacheStrategies][0]
			: cacheStrategies.size > 1
				? 'mixed'
				: undefined;
	aggregate.cacheDecision =
		cacheDecisions.size === 1
			? [...cacheDecisions][0]
			: cacheDecisions.size > 1
				? 'mixed'
				: undefined;
	aggregate.strategies = [...strategies];
	return analyzeTokens(aggregate);
}

export function compareRuns(baselineInput: unknown, optimizedInput: unknown): RunComparison {
	const baseline = analyzeTokens(baselineInput);
	const optimized = analyzeTokens(optimizedInput);
	const actualInputAvailable = baseline.actual.available && optimized.actual.available;
	return {
		baseline,
		optimized,
		delta: {
			inputTokens: actualInputAvailable
				? optimized.actual.inputTokens - baseline.actual.inputTokens
				: optimized.measurement.sent - baseline.measurement.sent,
			netTokens: optimized.savings.netTokens - baseline.savings.netTokens,
			latencyMs: optimized.measurement.latencyMs - baseline.measurement.latencyMs,
			fallbacks: optimized.measurement.fallbacks - baseline.measurement.fallbacks,
			qualityGuardFailures:
				optimized.measurement.qualityGuardFailures -
				baseline.measurement.qualityGuardFailures,
			inputTokenBasis: actualInputAvailable
				? 'provider-actual'
				: 'optimizer-estimate',
			...(baseline.cost && optimized.cost
				? { cost: optimized.cost.after - baseline.cost.after }
				: {}),
		},
	};
}
