import { deduplicateUnits, deduplicateWithProtectedTail } from './deduplicate';
import { splitUnits } from './normalize';
import type { ResolvedProfile } from './types';

function containsToolSequence(text: string): boolean {
	return /"(?:role)"\s*:\s*"(?:tool|function)"|"(?:tool_calls|tool_call_id|toolCalls|toolCallId)"\s*:/i.test(
		text,
	);
}

export function compressSection(text: string, profile: ResolvedProfile): string {
	return deduplicateUnits(splitUnits(text), profile.approximateDeduplication).join('\n');
}

export function compressHistory(text: string, profile: ResolvedProfile): string {
	// Message/tool adjacency is provider-sensitive. Preserve the exact sequence.
	if (containsToolSequence(text)) return text;
	return deduplicateWithProtectedTail(
		splitUnits(text),
		profile.keepRecentMessages,
		profile.approximateDeduplication,
	).join('\n');
}
