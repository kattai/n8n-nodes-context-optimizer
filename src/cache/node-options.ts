import type { CacheStrategy } from './policy-types';

const strategies = new Set<CacheStrategy>([
	'automatic_hybrid',
	'cache_priority',
	'token_reduction_priority',
	'ignore_cache_signals',
]);

export function resolveNodeCacheStrategy(parameters: Record<string, unknown>): CacheStrategy {
	const raw = parameters.cacheStrategy;
	return typeof raw === 'string' && strategies.has(raw as CacheStrategy)
		? (raw as CacheStrategy)
		: 'ignore_cache_signals';
}
