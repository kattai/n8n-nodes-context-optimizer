import { describe, expect, it } from 'vitest';
import { compileSystemPrompt } from '../../src/prompt/system-prompt-compiler';

describe('system prompt compiler', () => {
	it('removes only exact repeated units', () => {
		const unit = 'Use evidence before answering.\nNever invent values.';
		const result = compileSystemPrompt(`${unit}\n\n${unit}\n\nRespond in Portuguese.`);
		expect(result.changed).toBe(true);
		expect(result.content.match(/Use evidence/g)).toHaveLength(1);
		expect(result.content).toContain('Respond in Portuguese.');
		expect(result.savedTokens).toBeGreaterThan(0);
	});

	it('preserves code and protected blocks byte-for-byte', () => {
		const code = '```ts\nconst amount = 12850;\n```';
		const protectedBlock =
			'<context-saver-protected>Order ORD-8172 was NOT approved.</context-saver-protected>';
		const result = compileSystemPrompt(`Rules\n\nRules\n\n${code}\n\n${protectedBlock}`);
		expect(result.content).toContain(code);
		expect(result.content).toContain(protectedBlock);
		expect(result.qualityPassed).toBe(true);
	});

	it('returns original when savings are below the configured minimum', () => {
		const original = 'Unique system instruction.';
		const result = compileSystemPrompt(original, 10);
		expect(result.content).toBe(original);
		expect(result.changed).toBe(false);
		expect(result.savedTokens).toBe(0);
	});
});
