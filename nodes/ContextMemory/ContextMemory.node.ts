import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { defaultMemoryDirectory, FileSystemMemoryManager } from '../../src/memory/memory-manager';
import { RedisMemoryPersistence } from '../../src/memory/persistence';
import type { MemoryMessageInput, UpdateMemorySessionInput } from '../../src/memory/types';
import { memoryArray, memoryObject } from '../../src/memory/node-input';
import type {
	StorageCredentialValues,
	StorageProvider,
} from '../../src/storage/configured-store';
import { recordExecutionTelemetry } from '../../src/analytics/execution-telemetry-registry';
import { buildIsolationScope } from '../../src/storage/isolation-scope';
import { testContextSaverStorageApi } from '../../src/storage/credential-test';

type MemoryOperation = 'build' | 'delete' | 'inspect' | 'purgeExpired' | 'update';

function profileWindow(profile: string, customWindow: number): number {
	if (profile === 'quality') return 12;
	if (profile === 'savings') return 3;
	if (profile === 'custom') return customWindow;
	return 6;
}

export class ContextMemory implements INodeType {
	methods = { credentialTest: { testContextSaverStorageApi } };

	description: INodeTypeDescription = {
		displayName: 'Session Memory',
		name: 'contextMemory',
		icon: {
			light: 'file:context-memory.svg',
			dark: 'file:context-memory.dark.svg',
		},
		// @ts-expect-error n8n's public type currently omits the supported false value.
		usableAsTool: false,
		group: ['transform'],
		version: [1, 2],
		defaultVersion: 2,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Keep current facts and recent context small while preserving older session history outside the AI prompt',
		defaults: { name: 'Session Memory' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'contextSaverStorageApi',
				required: false,
				testedBy: 'testContextSaverStorageApi',
				displayName: 'Storage and Encryption (Optional)',
				displayOptions: { show: { '@version': [2] } },
			},
		],
		properties: [
			{
				displayName: 'Storage Provider',
				name: 'storageProvider',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Local or Shared Filesystem',
						value: 'filesystem',
						description: 'Simple local storage; use a shared path when n8n has multiple workers',
						action: 'Keep sessions on filesystem',
					},
					{
						name: 'Redis (Recommended for Production)',
						value: 'redis',
						description: 'Shared TTL storage for queue mode and many simultaneous conversations',
						action: 'Keep sessions in Redis',
					},
				],
				default: 'filesystem',
				displayOptions: { show: { '@version': [2] } },
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Build Context',
						value: 'build',
						description: 'Return compact session context ready to inject into an AI Agent',
						action: 'Build compact session context',
					},
					{
						name: 'Delete Session',
						value: 'delete',
						description: 'Delete one isolated session immediately',
						action: 'Delete a memory session',
					},
					{
						name: 'Inspect Session',
						value: 'inspect',
						description: 'View counts and optionally exact archived session data',
						action: 'Inspect a memory session',
					},
					{
						name: 'Purge Expired Sessions',
						value: 'purgeExpired',
						description: 'Remove sessions whose configured TTL has ended',
						action: 'Purge expired memory sessions',
					},
					{
						name: 'Update Session',
						value: 'update',
						description: 'Merge facts, state, messages, summary, and recoverable resource IDs',
						action: 'Update a memory session',
					},
				],
				default: 'update',
			},
			{
				displayName: 'Session Key',
				name: 'sessionKey',
				type: 'string',
				required: true,
				default: '={{ $json.sessionKey || $json.sessionId || "" }}',
				displayOptions: { hide: { operation: ['purgeExpired'] } },
				description:
					'Stable conversation ID; the same conversation must reuse the same key on every execution',
			},
			{
				displayName: 'Scope',
				name: 'scope',
				type: 'string',
				required: true,
				default: '={{ $workflow.id }}',
				displayOptions: { hide: { operation: ['purgeExpired'] } },
				description: 'Isolation boundary; equal session keys in different scopes never share data',
			},
			{
				displayName: 'Owner ID',
				name: 'ownerId',
				type: 'string',
				default: '={{ $json.ownerId || $json.userId || "" }}',
				displayOptions: {
					show: { '@version': [2] },
					hide: { operation: ['purgeExpired'] },
				},
				description: 'Optional user or tenant boundary that prevents shared-session access',
			},
			{
				displayName: 'Memory Profile',
				name: 'profile',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { operation: ['update'] } },
				options: [
					{
						name: 'Quality First',
						value: 'quality',
						description: 'Keep the last 12 messages intact for maximum conversational continuity',
					},
					{
						name: 'Balanced (Recommended)',
						value: 'balanced',
						description: 'Keep the last 6 messages and archive older messages outside the prompt',
					},
					{
						name: 'Maximum Savings',
						value: 'savings',
						description:
							'Keep the last 3 messages while corrections and pending work remain protected',
					},
					{
						name: 'Custom',
						value: 'custom',
						description: 'Choose the number of recent messages kept in the model context',
					},
				],
				default: 'balanced',
			},
			{
				displayName: 'Recent Messages to Keep',
				name: 'recentWindow',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 100, numberPrecision: 0 },
				default: 6,
				displayOptions: { show: { operation: ['update'], profile: ['custom'] } },
				description: 'Messages beyond this window are archived and omitted from the normal prompt',
			},
			{
				displayName: 'Pinned Facts',
				name: 'pinnedFacts',
				type: 'json',
				default: '={{ $json.pinnedFacts || {} }}',
				displayOptions: { show: { operation: ['update'] } },
				description:
					'Current facts keyed by stable name; changed values are versioned and only the newest enters the prompt',
			},
			{
				displayName: 'Structured State',
				name: 'structuredState',
				type: 'json',
				default: '={{ $json.structuredState || {} }}',
				displayOptions: { show: { operation: ['update'] } },
				description: 'Current goal, decisions, pending actions, or other compact workflow state',
			},
			{
				displayName: 'State Update Mode',
				name: 'stateMode',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Merge Fields',
						value: 'merge',
						description: 'Update supplied top-level fields and keep all other current state',
					},
					{
						name: 'Replace State',
						value: 'replace',
						description: 'Replace the complete structured state with the supplied object',
					},
				],
				default: 'merge',
				displayOptions: { show: { operation: ['update'] } },
			},
			{
				displayName: 'New Messages',
				name: 'messages',
				type: 'json',
				default: '={{ $json.messages || $json.recentMessages || [] }}',
				displayOptions: { show: { operation: ['update'] } },
				description:
					'Array of {role, content}; add kind correction, pending, decision, or active_failure to protect it',
			},
			{
				displayName: 'Incremental Summary',
				name: 'summaryCandidate',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '={{ $json.summaryCandidate || "" }}',
				displayOptions: { show: { operation: ['update'] } },
				description:
					'Optional summary of older history; invalid or stale text never replaces the last valid summary',
			},
			{
				displayName: 'Summary Based on Revision',
				name: 'summaryBasedOnRevision',
				type: 'number',
				typeOptions: { minValue: -1, numberPrecision: 0 },
				default: -1,
				displayOptions: { show: { operation: ['update'] } },
				description:
					'Optional optimistic-lock revision; -1 accepts the summary against the current session',
			},
			{
				displayName: 'Summary Safety',
				name: 'summarySafety',
				type: 'collection',
				placeholder: 'Add Safety Option',
				default: {},
				displayOptions: { show: { operation: ['update'] } },
				options: [
					{
						displayName: 'Maximum Summary Tokens',
						name: 'maximumTokens',
						type: 'number',
						typeOptions: { minValue: 100, maxValue: 32000, numberPrecision: 0 },
						default: 4000,
						description: 'Reject a summary above this estimated token count',
					},
					{
						displayName: 'Required Exact Values',
						name: 'requiredValues',
						type: 'string',
						typeOptions: { rows: 3 },
						default: '',
						description: 'One exact value per line; summary is rejected if any value disappears',
					},
				],
			},
			{
				displayName: 'Archived Resource References',
				name: 'archivedResources',
				type: 'json',
				default: '={{ $json.archivedResources || [] }}',
				displayOptions: { show: { operation: ['update'] } },
				description:
					'Context Storage resource IDs kept as small references so exact original data remains recoverable',
			},
			{
				displayName: 'Session TTL (Hours)',
				name: 'ttlHours',
				type: 'number',
				typeOptions: { minValue: 0.02, maxValue: 8760, numberPrecision: 2 },
				default: 168,
				displayOptions: { show: { operation: ['update'] } },
				description: 'Hours since the latest update before the complete session expires',
			},
			{
				displayName: 'Storage Directory',
				name: 'storageDirectory',
				type: 'string',
				default: '',
				placeholder: defaultMemoryDirectory(),
				displayOptions: { hide: { storageProvider: ['redis'] } },
				description: 'Self-hosted storage path; empty uses the n8n user folder',
			},
			{
				displayName: 'Redis Key Prefix',
				name: 'redisKeyPrefix',
				type: 'string',
				default: 'context-saver',
				displayOptions: { show: { '@version': [2], storageProvider: ['redis'] } },
				description: 'Namespace used to keep this installation separate inside Redis',
			},
			{
				displayName: 'Encrypt Stored Sessions',
				name: 'encryptStorage',
				type: 'boolean',
				default: false,
				displayOptions: { show: { '@version': [2] } },
				description: 'Whether to encrypt compressed session data with AES-256-GCM before storage',
			},
			{
				displayName: 'Maximum Session Size (MB)',
				name: 'maxSessionMegabytes',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 100, numberPrecision: 0 },
				default: 2,
				displayOptions: { show: { operation: ['update'] } },
				description: 'Reject a session larger than this uncompressed size',
			},
			{
				displayName: 'Output',
				name: 'outputDetail',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Simple (Recommended)',
						value: 'simple',
						description: 'Return compact counts and identifiers needed by later nodes',
					},
					{
						name: 'Detailed',
						value: 'detailed',
						description: 'Also return exact facts, state, versions, and archived events',
					},
				],
				default: 'simple',
				displayOptions: { show: { operation: ['inspect', 'update'] } },
				description: 'Detailed output can be large; keep Simple when feeding later AI nodes',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const nodeVersion = this.getNode().typeVersion;
				const operation = this.getNodeParameter('operation', itemIndex) as MemoryOperation;
				const configuredDirectory = this.getNodeParameter(
					'storageDirectory',
					itemIndex,
					'',
				) as string;
			const maxSessionMegabytes = this.getNodeParameter(
					'maxSessionMegabytes',
					itemIndex,
					2,
				) as number;
				const provider = this.getNodeParameter(
					'storageProvider',
					itemIndex,
					'filesystem',
				) as StorageProvider;
				const encryptStorage = this.getNodeParameter(
					'encryptStorage',
					itemIndex,
					false,
				) as boolean;
				let credentials: StorageCredentialValues = {};
				if (nodeVersion >= 2 && (provider === 'redis' || encryptStorage)) {
					credentials = (await this.getCredentials(
						'contextSaverStorageApi',
						itemIndex,
					)) as StorageCredentialValues;
				}
				const redisUrl = String(credentials.redisUrl ?? '').trim();
				if (nodeVersion >= 2 && provider === 'redis' && !redisUrl) {
					throw new NodeOperationError(
						this.getNode(),
						'Select Context Saver Storage API credentials with a Redis URL',
						{ itemIndex },
					);
				}
				const encryptionKey = encryptStorage
					? String(credentials.encryptionKey ?? '').trim()
					: undefined;
				if (nodeVersion >= 2 && encryptStorage && !encryptionKey) {
					throw new NodeOperationError(
						this.getNode(),
						'Select Context Saver Storage API credentials with an encryption key',
						{ itemIndex },
					);
				}
				const persistence =
					nodeVersion >= 2 && provider === 'redis'
						? new RedisMemoryPersistence({
								url: redisUrl,
								username: String(credentials.redisUsername ?? '').trim() || undefined,
								password: String(credentials.redisPassword ?? '').trim() || undefined,
								keyPrefix: this.getNodeParameter(
									'redisKeyPrefix',
									itemIndex,
									'context-saver',
								) as string,
							})
						: undefined;
				const memory = new FileSystemMemoryManager(
					configuredDirectory.trim() || defaultMemoryDirectory(),
					maxSessionMegabytes * 1024 * 1024,
					persistence,
					nodeVersion >= 2 ? encryptionKey : undefined,
				);
				let result: IDataObject;

				if (operation === 'purgeExpired') {
					result = { purged: await memory.purgeExpired() };
				} else {
					const sessionKey = this.getNodeParameter('sessionKey', itemIndex) as string;
					const scope = buildIsolationScope(
						this.getNodeParameter('scope', itemIndex, this.getWorkflow().id) as string,
						'',
						nodeVersion >= 2
							? (this.getNodeParameter('ownerId', itemIndex, '') as string)
							: '',
					);
					if (operation === 'build') {
						const built = await memory.buildContext({ sessionKey, scope });
						result = built as unknown as IDataObject;
						recordExecutionTelemetry({
							executionId: this.getExecutionId(),
							nodeName: this.getNode().name,
							component: 'session_memory',
							recordedAt: new Date().toISOString(),
							tokensBefore: built.sourceEstimatedTokens,
							tokensAfter: built.estimatedTokens,
						});
					} else if (operation === 'delete') {
						result = { sessionKey, scope, deleted: await memory.deleteSession(sessionKey, scope) };
					} else if (operation === 'inspect') {
						const session = await memory.inspectSession(sessionKey, scope);
						result = {
							sessionKey,
							scope,
							revision: session.revision,
							expiresAt: session.expiresAt,
							counts: {
								facts: Object.keys(session.pinnedFacts).length,
								stateFields: Object.keys(session.structuredState).length,
								recentMessages: session.recentMessages.length,
								protectedItems: session.protectedItems.length,
								archivedEvents: session.archivedEvents.length,
								archivedResources: session.archivedResources.length,
							} as IDataObject,
						};
						if (this.getNodeParameter('outputDetail', itemIndex, 'simple') === 'detailed') {
							result.session = session as unknown as IDataObject;
						}
					} else {
						const profile = this.getNodeParameter('profile', itemIndex, 'balanced') as string;
						const summaryCandidate = this.getNodeParameter(
							'summaryCandidate',
							itemIndex,
							'',
						) as string;
						const summaryBasedOnRevision = this.getNodeParameter(
							'summaryBasedOnRevision',
							itemIndex,
							-1,
						) as number;
						const summarySafety = this.getNodeParameter('summarySafety', itemIndex, {}) as {
							maximumTokens?: number;
							requiredValues?: string;
						};
						const update: UpdateMemorySessionInput = {
							sessionKey,
							scope,
							ttlSeconds: (this.getNodeParameter('ttlHours', itemIndex, 168) as number) * 3600,
							recentWindow: profileWindow(
								profile,
								this.getNodeParameter('recentWindow', itemIndex, 6) as number,
							),
							pinnedFacts: memoryObject(
								this.getNodeParameter('pinnedFacts', itemIndex, {}),
								'Pinned Facts',
							),
							structuredState: memoryObject(
								this.getNodeParameter('structuredState', itemIndex, {}),
								'Structured State',
							),
							stateMode: this.getNodeParameter('stateMode', itemIndex, 'merge') as
								| 'merge'
								| 'replace',
							messages: memoryArray(
								this.getNodeParameter('messages', itemIndex, []),
								'New Messages',
							) as MemoryMessageInput[],
							archivedResources: memoryArray(
								this.getNodeParameter('archivedResources', itemIndex, []),
								'Archived Resource References',
							) as UpdateMemorySessionInput['archivedResources'],
							...(summaryCandidate.trim() ? { summaryCandidate } : {}),
							...(summaryBasedOnRevision >= 0 ? { summaryBasedOnRevision } : {}),
							summaryMaximumTokens: summarySafety.maximumTokens ?? 4000,
							summaryRequiredValues: String(summarySafety.requiredValues ?? '')
								.split(/\r?\n/)
								.map((value) => value.trim())
								.filter(Boolean),
						};
						const updated = await memory.updateSession(update);
						const built = nodeVersion >= 2
							? await memory.buildContext({ sessionKey, scope })
							: undefined;
						result = {
							updated: true,
							sessionKey,
							scope,
							revision: updated.session.revision,
							expiresAt: updated.session.expiresAt,
							warnings: updated.warnings,
							...(built
								? {
									memoryContext: built.context,
									estimatedTokens: built.estimatedTokens,
									selectedProfile: profile,
									effectiveProfile: profile,
								}
								: {}),
							counts: {
								facts: Object.keys(updated.session.pinnedFacts).length,
								stateFields: Object.keys(updated.session.structuredState).length,
								recentMessages: updated.session.recentMessages.length,
								protectedItems: updated.session.protectedItems.length,
								archivedEvents: updated.session.archivedEvents.length,
								archivedResources: updated.session.archivedResources.length,
							} as IDataObject,
						};
						if (this.getNodeParameter('outputDetail', itemIndex, 'simple') === 'detailed') {
							result.session = updated.session as unknown as IDataObject;
						}
						if (built) {
							recordExecutionTelemetry({
								executionId: this.getExecutionId(),
								nodeName: this.getNode().name,
								component: 'session_memory',
								recordedAt: new Date().toISOString(),
								tokensBefore: built.sourceEstimatedTokens,
								tokensAfter: built.estimatedTokens,
								selectedProfile: profile,
								effectiveProfile: profile,
							});
						}
					}
				}

				returnData.push({ json: result, pairedItem: { item: itemIndex } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: error instanceof Error ? error.message : String(error) },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw new NodeOperationError(
					this.getNode(),
					error instanceof Error ? error : new Error(String(error)),
					{ itemIndex },
				);
			}
		}
		return [returnData];
	}
}
