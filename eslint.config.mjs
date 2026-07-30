import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

export default [
	...configWithoutCloudSupport,
	{
		files: ['package.json'],
		rules: {
			// Internal self-hosted package: these exact versions match n8n 2.32.1.
			'@n8n/community-nodes/no-runtime-dependencies': 'off',
		},
	},
];
