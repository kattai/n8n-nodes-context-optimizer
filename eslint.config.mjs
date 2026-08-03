import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

export default [
	...configWithoutCloudSupport,
	{
		files: ['package.json'],
		rules: {
			// Internal self-hosted package: these exact versions match n8n 2.32.1.
			'@n8n/community-nodes/no-runtime-dependencies': 'off',
			// Only ContextSaver is public; the other node classes are internal delegates.
			'@n8n/community-nodes/node-registration-complete': 'off',
		},
	},
	{
		files: ['nodes/TokenAnalytics/TokenAnalytics.node.ts'],
		rules: {
			// Operations are surfaced as the Savings Report resource of the unified node.
			'@n8n/community-nodes/resource-operation-pattern': 'off',
		},
	},
];
