import { stableSerialize } from '../context/canonical-context';
import type { VersionedFact } from './types';

export function updateVersionedFacts(
	existing: Record<string, VersionedFact>,
	updates: Record<string, unknown>,
	now: string,
): Record<string, VersionedFact> {
	const result = { ...existing };
	for (const [key, value] of Object.entries(updates)) {
		const current = result[key];
		if (!current) {
			result[key] = {
				key,
				value,
				version: 1,
				status: 'current',
				updatedAt: now,
				history: [],
			};
			continue;
		}
		if (stableSerialize(current.value) === stableSerialize(value)) continue;
		result[key] = {
			key,
			value,
			version: current.version + 1,
			status: 'current',
			updatedAt: now,
			history: [
				...current.history,
				{
					version: current.version,
					value: current.value,
					status: 'superseded',
					validFrom: current.updatedAt,
					validUntil: now,
				},
			],
		};
	}
	return result;
}
