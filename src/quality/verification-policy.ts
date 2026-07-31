export type QualityVerificationLevel = 'critical' | 'fast' | 'strict';

export interface VerificationPolicy {
	level: QualityVerificationLevel;
	checkFactPolarity: boolean;
	checkNegatedStatements: boolean;
	checkQuotedValues: boolean;
}

export function resolveVerificationPolicy(
	level: QualityVerificationLevel = 'strict',
): VerificationPolicy {
	if (level === 'fast') {
		return {
			level,
			checkFactPolarity: false,
			checkNegatedStatements: false,
			checkQuotedValues: false,
		};
	}
	if (level === 'critical') {
		return {
			level,
			checkFactPolarity: true,
			checkNegatedStatements: true,
			checkQuotedValues: true,
		};
	}
	return {
		level,
		checkFactPolarity: true,
		checkNegatedStatements: true,
		checkQuotedValues: false,
	};
}
