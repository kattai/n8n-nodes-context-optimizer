import type { PublicOptimizerProfileName, ResolvedProfile } from '../core/types';

export type BuiltInProfileName = Exclude<PublicOptimizerProfileName, 'custom'>;

export const profileContracts: Record<BuiltInProfileName, ResolvedProfile> = {
	quality: {
		name: 'quality',
		canonicalName: 'quality',
		keepRecentMessages: 12,
		maxInputTokens: 24_000,
		summaryThresholdTokens: 12_000,
		approximateDeduplication: false,
		allowUniqueContentTrimming: false,
		minimumNetSavingsTokens: 64,
		eligibleSavingsMinPercent: 15,
		eligibleSavingsMaxPercent: 35,
		virtualization: 'disabled',
		semanticOptimization: false,
	},
	balanced: {
		name: 'balanced',
		canonicalName: 'balanced',
		keepRecentMessages: 6,
		maxInputTokens: 16_000,
		summaryThresholdTokens: 8_000,
		approximateDeduplication: false,
		allowUniqueContentTrimming: false,
		minimumNetSavingsTokens: 128,
		eligibleSavingsMinPercent: 35,
		eligibleSavingsMaxPercent: 60,
		virtualization: 'automatic',
		semanticOptimization: false,
	},
	savings: {
		name: 'savings',
		canonicalName: 'savings',
		keepRecentMessages: 3,
		maxInputTokens: 8_000,
		summaryThresholdTokens: 4_000,
		approximateDeduplication: true,
		allowUniqueContentTrimming: false,
		minimumNetSavingsTokens: 256,
		eligibleSavingsMinPercent: 60,
		eligibleSavingsMaxPercent: 85,
		virtualization: 'required',
		semanticOptimization: false,
	},
};
