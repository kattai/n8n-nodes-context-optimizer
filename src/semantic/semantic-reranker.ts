import { estimateTokens } from '../core/token-estimator';
import type { SemanticRerankAdapter, SemanticStageResult, SemanticUnit } from './types';

export interface SemanticRerankOptions {
	currentTask: string;
	minimumConfidence: number;
	maximumUnits: number;
	maximumSelectedUnits: number;
	tokenBudget: number;
}

function tokens(units: SemanticUnit[]): number {
	return units.reduce((total, unit) => total + estimateTokens(unit.text), 0);
}

function fallback(
	units: SemanticUnit[],
	reason: SemanticStageResult['fallbackReason'],
	confidence = 0,
	compressorTokens = 0,
): SemanticStageResult {
	return {
		units,
		applied: false,
		confidence,
		compressorTokens,
		savedTokens: 0,
		fallbackReason: reason,
	};
}

export async function semanticRerank(
	units: SemanticUnit[],
	adapter: SemanticRerankAdapter,
	options: SemanticRerankOptions,
): Promise<SemanticStageResult> {
	if (units.length > options.maximumUnits) return fallback(units, 'too_many_units');
	try {
		const response = await adapter.rerank({
			units,
			currentTask: options.currentTask,
			protectedIds: units.filter((unit) => unit.protected).map((unit) => unit.id),
		});
		const compressorTokens = Math.max(0, response.compressorTokens ?? 0);
		const confidence = Number.isFinite(response.confidence) ? response.confidence : 0;
		if (confidence < options.minimumConfidence) {
			return fallback(units, 'low_confidence', confidence, compressorTokens);
		}
		const byId = new Map(units.map((unit) => [unit.id, unit]));
		if (
			response.rankedIds.length === 0 ||
			response.rankedIds.some((id) => !byId.has(id)) ||
			new Set(response.rankedIds).size !== response.rankedIds.length
		) {
			return fallback(units, 'invalid_adapter_response', confidence, compressorTokens);
		}
		const selected = new Set(units.filter((unit) => unit.protected).map((unit) => unit.id));
		if (selected.size > options.maximumSelectedUnits) {
			return fallback(units, 'protected_unit_missing', confidence, compressorTokens);
		}
		let selectedTokens = units
			.filter((unit) => selected.has(unit.id))
			.reduce((total, unit) => total + estimateTokens(unit.text), 0);
		if (selectedTokens > options.tokenBudget) {
			return fallback(units, 'protected_unit_missing', confidence, compressorTokens);
		}
		for (const id of response.rankedIds) {
			if (selected.has(id) || selected.size >= options.maximumSelectedUnits) continue;
			const unit = byId.get(id);
			if (!unit) continue;
			const unitTokens = estimateTokens(unit.text);
			if (selectedTokens + unitTokens > options.tokenBudget) continue;
			selected.add(id);
			selectedTokens += unitTokens;
		}
		if (units.some((unit) => unit.protected && !selected.has(unit.id))) {
			return fallback(units, 'protected_unit_missing', confidence, compressorTokens);
		}
		const kept = units.filter((unit) => selected.has(unit.id));
		if (kept.length === 0 || kept.length >= units.length) {
			return fallback(units, 'no_reduction', confidence, compressorTokens);
		}
		const grossSaved = tokens(units) - tokens(kept);
		const netSaved = grossSaved - compressorTokens;
		if (netSaved <= 0) {
			return fallback(units, 'negative_net_savings', confidence, compressorTokens);
		}
		return {
			units: kept,
			applied: true,
			confidence,
			compressorTokens,
			savedTokens: netSaved,
		};
	} catch {
		return fallback(units, 'adapter_error');
	}
}
