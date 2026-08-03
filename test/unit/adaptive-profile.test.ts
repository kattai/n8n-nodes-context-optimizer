import { describe, expect, it } from 'vitest';
import { resolveAdaptiveProfile } from '../../src/policy/adaptive-profile';

describe('adaptive profile', () => {
	it('keeps the selected profile for low-risk context', () => {
		expect(resolveAdaptiveProfile('savings', [])).toMatchObject({
			selectedProfile: 'savings',
			effectiveProfile: 'savings',
			riskLevel: 'low',
			downgraded: false,
		});
	});

	it('downgrades savings to balanced when exact recovery is unavailable', () => {
		expect(resolveAdaptiveProfile('savings', ['retrieval_unavailable'])).toMatchObject({
			effectiveProfile: 'balanced',
			riskLevel: 'medium',
			downgraded: true,
		});
	});

	it('downgrades any built-in profile to quality for high-risk context', () => {
		expect(resolveAdaptiveProfile('savings', ['structured_output'])).toMatchObject({
			effectiveProfile: 'quality',
			riskLevel: 'high',
			downgraded: true,
		});
	});

	it('does not silently rewrite custom policy', () => {
		expect(resolveAdaptiveProfile('custom', ['code_or_query'])).toMatchObject({
			effectiveProfile: 'custom',
			downgraded: false,
		});
	});
});
