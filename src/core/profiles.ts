import { profileContracts } from '../policy/profile-contracts';
import type {
	CustomProfileConfig,
	OptimizerProfileName,
	PublicOptimizerProfileName,
	ResolvedProfile,
} from './types';

const aliases: Record<OptimizerProfileName, PublicOptimizerProfileName> = {
	safe: 'quality',
	quality: 'quality',
	balanced: 'balanced',
	aggressive: 'savings',
	savings: 'savings',
	custom: 'custom',
};

const customDefaults: ResolvedProfile = {
	...profileContracts.balanced,
	name: 'custom',
	canonicalName: 'custom',
	virtualization: 'automatic',
};

function validateInteger(name: string, value: number, minimum: number): void {
	if (!Number.isInteger(value) || value < minimum) {
		throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
	}
}

function validatePercent(name: string, value: number): void {
	if (!Number.isFinite(value) || value < 0 || value > 100) {
		throw new Error(`${name} must be between 0 and 100`);
	}
}

export function canonicalProfileName(
	name: OptimizerProfileName = 'balanced',
): PublicOptimizerProfileName {
	return aliases[name];
}

export function isQualityProfile(name?: OptimizerProfileName): boolean {
	return canonicalProfileName(name ?? 'balanced') === 'quality';
}

export function isSavingsProfile(name?: OptimizerProfileName): boolean {
	return canonicalProfileName(name ?? 'balanced') === 'savings';
}

export function resolveProfile(
	name: OptimizerProfileName = 'balanced',
	custom: CustomProfileConfig = {},
): ResolvedProfile {
	const canonicalName = canonicalProfileName(name);
	const base = canonicalName === 'custom' ? customDefaults : profileContracts[canonicalName];
	const resolved: ResolvedProfile = {
		...base,
		...(canonicalName === 'custom' ? custom : {}),
		name,
		canonicalName,
	};

	validateInteger('keepRecentMessages', resolved.keepRecentMessages, 0);
	validateInteger('maxInputTokens', resolved.maxInputTokens, 1);
	validateInteger('summaryThresholdTokens', resolved.summaryThresholdTokens, 1);
	validateInteger('minimumNetSavingsTokens', resolved.minimumNetSavingsTokens, 0);
	validatePercent('eligibleSavingsMinPercent', resolved.eligibleSavingsMinPercent);
	validatePercent('eligibleSavingsMaxPercent', resolved.eligibleSavingsMaxPercent);
	if (resolved.eligibleSavingsMinPercent > resolved.eligibleSavingsMaxPercent) {
		throw new Error('eligibleSavingsMinPercent must not exceed eligibleSavingsMaxPercent');
	}

	return resolved;
}
