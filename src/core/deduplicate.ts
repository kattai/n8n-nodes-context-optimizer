function comparable(text: string): string {
	return text
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

function wordSet(text: string): Set<string> {
	return new Set(comparable(text).split(/\s+/).filter(Boolean));
}

function similarity(left: string, right: string): number {
	const leftWords = wordSet(left);
	const rightWords = wordSet(right);
	if (leftWords.size === 0 || rightWords.size === 0) return 0;
	let intersection = 0;
	for (const word of leftWords) if (rightWords.has(word)) intersection++;
	return intersection / Math.max(leftWords.size, rightWords.size);
}

function controlSignature(text: string): string {
	const value = comparable(text);
	const flags = [
		/\b(nao|nunca|jamais|sem|proibid[oa]s?|vedad[oa]s?|impedid[oa]s?)\b/u.test(value)
			? 'negative'
			: 'affirmative',
		/\b(pode|podem|permitid[oa]s?|autorizad[oa]s?)\b/u.test(value)
			? 'permission'
			: '',
		/\b(deve|devem|obrigatori[oa]s?|necessari[oa]s?)\b/u.test(value)
			? 'obligation'
			: '',
	].filter(Boolean);
	return flags.join(':');
}

export function deduplicateUnits(units: string[], approximate = false): string[] {
	const accepted: string[] = [];
	const exact = new Set<string>();

	for (const unit of units) {
		const key = comparable(unit);
		if (!key || exact.has(key)) continue;
		if (
			approximate &&
			accepted.some(
				(existing) =>
					controlSignature(existing) === controlSignature(unit) &&
					similarity(existing, unit) >= 0.94,
			)
		) {
			continue;
		}
		exact.add(key);
		accepted.push(unit);
	}

	return accepted;
}

export function deduplicateWithProtectedTail(
	units: string[],
	keepRecent: number,
	approximate = false,
): string[] {
	const protectedStart = Math.max(0, units.length - keepRecent);
	const accepted = deduplicateUnits(units.slice(protectedStart), approximate);
	const acceptedIndexes = new Set<number>();
	for (let index = protectedStart - 1; index >= 0; index--) {
		const next = deduplicateUnits([...accepted, units[index]], approximate);
		if (next.length === accepted.length) continue;
		accepted.push(units[index]);
		acceptedIndexes.add(index);
	}
	return units.filter((_, index) => index >= protectedStart || acceptedIndexes.has(index));
}
