import { estimateTokens } from '../core/token-estimator';
import type { SemanticDeduplicationAdapter, SemanticStageResult, SemanticUnit } from './types';

export interface SemanticDeduplicationOptions {
	currentTask: string;
	minimumConfidence: number;
	maximumUnits: number;
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

export async function semanticDeduplicate(
	units: SemanticUnit[],
	adapter: SemanticDeduplicationAdapter,
	options: SemanticDeduplicationOptions,
): Promise<SemanticStageResult> {
	if (units.length > options.maximumUnits) return fallback(units, 'too_many_units');
	try {
		const response = await adapter.deduplicate({
			units,
			currentTask: options.currentTask,
			protectedIds: units.filter((unit) => unit.protected).map((unit) => unit.id),
		});
		const compressorTokens = Math.max(0, response.compressorTokens ?? 0);
		const confidence = Number.isFinite(response.confidence) ? response.confidence : 0;
		if (confidence < options.minimumConfidence) {
			return fallback(units, 'low_confidence', confidence, compressorTokens);
		}
		const ids = new Set(units.map((unit) => unit.id));
		const keepIds = new Set(response.keepIds);
		if (
			response.keepIds.length === 0 ||
			response.keepIds.some((id) => !ids.has(id)) ||
			keepIds.size !== response.keepIds.length
		) {
			return fallback(units, 'invalid_adapter_response', confidence, compressorTokens);
		}
		if (units.some((unit) => unit.protected && !keepIds.has(unit.id))) {
			return fallback(units, 'protected_unit_missing', confidence, compressorTokens);
		}
		const selected = units.filter((unit) => keepIds.has(unit.id));
		if (selected.length >= units.length) {
			return fallback(units, 'no_reduction', confidence, compressorTokens);
		}
		const grossSaved = tokens(units) - tokens(selected);
		const netSaved = grossSaved - compressorTokens;
		if (netSaved <= 0) {
			return fallback(units, 'negative_net_savings', confidence, compressorTokens);
		}
		return {
			units: selected,
			applied: true,
			confidence,
			compressorTokens,
			savedTokens: netSaved,
		};
	} catch {
		return fallback(units, 'adapter_error');
	}
}
