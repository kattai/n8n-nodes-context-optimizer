import type {
	CustomProfileConfig,
	OptimizerProfileName,
	ResolvedProfile,
} from './types';

const profiles: Record<Exclude<OptimizerProfileName, 'custom'>, ResolvedProfile> = {
	safe: {
		name: 'safe',
		keepRecentMessages: 12,
		maxInputTokens: 24000,
		summaryThresholdTokens: 12000,
		approximateDeduplication: false,
		allowUniqueContentTrimming: false,
	},
	balanced: {
		name: 'balanced',
		keepRecentMessages: 6,
		maxInputTokens: 16000,
		summaryThresholdTokens: 8000,
		approximateDeduplication: false,
		allowUniqueContentTrimming: false,
	},
	aggressive: {
		name: 'aggressive',
		keepRecentMessages: 3,
		maxInputTokens: 8000,
		summaryThresholdTokens: 4000,
		approximateDeduplication: true,
		allowUniqueContentTrimming: false,
	},
};

const customDefaults: ResolvedProfile = {
	...profiles.balanced,
	name: 'custom',
};

function validateInteger(name: string, value: number, minimum: number): void {
	if (!Number.isInteger(value) || value < minimum) {
		throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
	}
}

export function resolveProfile(
	name: OptimizerProfileName = 'balanced',
	custom: CustomProfileConfig = {},
): ResolvedProfile {
	const base = name === 'custom' ? customDefaults : profiles[name];
	const resolved: ResolvedProfile = {
		...base,
		...(name === 'custom' ? custom : {}),
		name,
	};

	validateInteger('keepRecentMessages', resolved.keepRecentMessages, 0);
	validateInteger('maxInputTokens', resolved.maxInputTokens, 1);
	validateInteger('summaryThresholdTokens', resolved.summaryThresholdTokens, 1);

	return resolved;
}
