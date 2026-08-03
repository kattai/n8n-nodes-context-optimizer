import { describe, expect, it } from 'vitest';
import {
	compatibilityContract,
	legacyProfileAliases,
	stableNodeTypeIds,
} from '../../src/versioning/compatibility';

describe('public compatibility contract', () => {
	it('keeps node type IDs and legacy profiles stable', () => {
		expect(stableNodeTypeIds).toEqual([
			'contextOptimizer',
			'contextMemory',
			'contextRetrieverTool',
			'contextStore',
			'optimizedChatModel',
			'tokenAnalytics',
		]);
		expect(legacyProfileAliases).toEqual({ safe: 'quality', aggressive: 'savings' });
		expect(compatibilityContract.minimumReadableStorageVersion).toBe(1);
	});
});
