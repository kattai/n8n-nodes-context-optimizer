import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class ContextSaverStorageApi implements ICredentialType {
	name = 'contextSaverStorageApi';
	displayName = 'Context Saver Storage API';
	icon = 'file:context-saver-storage.svg' as const;
	documentationUrl = 'https://github.com/kattai/n8n-nodes-context-optimizer';
	properties: INodeProperties[] = [
		{
			displayName: 'Redis URL',
			name: 'redisUrl',
			type: 'string',
			default: 'redis://localhost:6379',
			placeholder: 'rediss://redis.example.com:6379',
			description: 'Use redis:// for local TLS-free Redis or rediss:// for TLS',
		},
		{
			displayName: 'Redis Username',
			name: 'redisUsername',
			type: 'string',
			default: '',
		},
		{
			displayName: 'Redis Password',
			name: 'redisPassword',
			type: 'string',
			typeOptions: { password: true },
			default: '',
		},
		{
			displayName: 'Encryption Key',
			name: 'encryptionKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Optional secret with at least 16 characters; enables AES-256-GCM encryption before filesystem or Redis storage',
		},
	];
}
