import type { ContextCategory } from '../context/types';

export interface CategoryDemand {
	category: ContextCategory;
	demandTokens: number;
	minimumTokens?: number;
	weight?: number;
	protected?: boolean;
}

export function allocateCategoryBudget(
	totalTokens: number,
	demands: CategoryDemand[],
): Record<ContextCategory, number> {
	const total = Math.max(0, Math.floor(totalTokens));
	const result = Object.fromEntries(demands.map((demand) => [demand.category, 0])) as Partial<
		Record<ContextCategory, number>
	>;
	let remaining = total;
	for (const demand of demands) {
		const minimum = Math.min(
			Math.max(0, demand.minimumTokens ?? (demand.protected ? demand.demandTokens : 0)),
			demand.demandTokens,
		);
		result[demand.category] = minimum;
		remaining = Math.max(0, remaining - minimum);
	}
	let active = demands.filter((demand) => (result[demand.category] ?? 0) < demand.demandTokens);
	while (remaining > 0 && active.length > 0) {
		const totalWeight = active.reduce((sum, demand) => sum + Math.max(0.01, demand.weight ?? 1), 0);
		let distributed = 0;
		for (const demand of active) {
			const current = result[demand.category] ?? 0;
			const need = demand.demandTokens - current;
			const share = Math.max(
				1,
				Math.floor((remaining * Math.max(0.01, demand.weight ?? 1)) / totalWeight),
			);
			const grant = Math.min(need, share, remaining - distributed);
			if (grant <= 0) continue;
			result[demand.category] = current + grant;
			distributed += grant;
		}
		if (distributed === 0) break;
		remaining -= distributed;
		active = active.filter((demand) => (result[demand.category] ?? 0) < demand.demandTokens);
	}
	return result as Record<ContextCategory, number>;
}
