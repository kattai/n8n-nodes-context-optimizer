import type { TokenModelFamily } from './types';

export function detectModelFamily(model?: string): Exclude<TokenModelFamily, 'custom'> {
	const normalized = String(model ?? '')
		.trim()
		.toLowerCase();
	if (!normalized) return 'generic';
	if (/gpt|o1(?:-|$)|o3(?:-|$)|o4(?:-|$)|openai|chatgpt/.test(normalized)) return 'openai';
	if (/claude|anthropic/.test(normalized)) return 'anthropic';
	if (/gemini|gemma|google/.test(normalized)) return 'gemini';
	if (/llama|codellama|meta/.test(normalized)) return 'llama';
	if (/mistral|mixtral|codestral/.test(normalized)) return 'mistral';
	return 'generic';
}
