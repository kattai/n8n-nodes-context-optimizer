export const stableNodeTypeIds = Object.freeze([
	'contextOptimizer',
	'contextMemory',
	'contextRetrieverTool',
	'contextStore',
	'optimizedChatModel',
	'tokenAnalytics',
]);

export const legacyProfileAliases = Object.freeze({
	safe: 'quality',
	aggressive: 'savings',
});

export const compatibilityContract = Object.freeze({
	minimumReadableStorageVersion: 1,
	currentStorageVersion: 3,
	legacyNodeVersions: [1, 2],
	stableParameterNames: ['profile', 'customProfile', 'operation'],
});
