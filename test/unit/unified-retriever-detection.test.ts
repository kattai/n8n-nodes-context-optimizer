import type { ISupplyDataFunctions } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';
import {
	hasCompatibleRetriever,
	isExactLookupNode,
	retrieverMatchesConfiguration,
} from '../../nodes/OptimizedChatModel/OptimizedChatModel.node';

const filesystemExpectation = {
	workflowId: 'workflow-1',
	scope: 'workflow-1',
	directory: 'C:\\context-saver',
	provider: 'filesystem' as const,
	redisKeyPrefix: 'context-saver',
	encryptStorage: false,
};

describe('unified Exact Lookup detection', () => {
	it('recognizes legacy and unified Retriever nodes without accepting another unified feature', () => {
		expect(isExactLookupNode({ type: 'n8n-nodes-context-optimizer.contextRetrieverTool' })).toBe(
			true,
		);
		expect(
			isExactLookupNode({
				type: 'n8n-nodes-context-optimizer.contextSaver',
				parameters: { resource: 'exactLookup' },
			}),
		).toBe(true);
		expect(
			isExactLookupNode({
				type: 'n8n-nodes-context-optimizer.contextSaver',
				parameters: { resource: 'agentModel' },
			}),
		).toBe(false);
	});

	it('requires matching isolation and filesystem settings', () => {
		const node = {
			type: 'n8n-nodes-context-optimizer.contextSaver',
			parameters: {
				resource: 'exactLookup',
				scope: '={{ $workflow.id }}',
				storageDirectory: 'C:\\context-saver',
				storageProvider: 'filesystem',
				encryptStorage: false,
			},
		};
		expect(retrieverMatchesConfiguration(node, filesystemExpectation)).toBe(true);
		expect(
			retrieverMatchesConfiguration(
				{ ...node, parameters: { ...node.parameters, storageDirectory: 'C:\\other' } },
				filesystemExpectation,
			),
		).toBe(false);
	});

	it('requires matching Redis prefix and encryption settings', () => {
		const expectation = {
			...filesystemExpectation,
			provider: 'redis' as const,
			redisKeyPrefix: 'tenant-context',
			encryptStorage: true,
		};
		const node = {
			type: 'n8n-nodes-context-optimizer.contextSaver',
			parameters: {
				resource: 'exactLookup',
				scope: 'workflow-1',
				storageProvider: 'redis',
				redisKeyPrefix: 'tenant-context',
				encryptStorage: true,
			},
		};
		expect(retrieverMatchesConfiguration(node, expectation)).toBe(true);
		expect(
			retrieverMatchesConfiguration(
				{ ...node, parameters: { ...node.parameters, encryptStorage: false } },
				expectation,
			),
		).toBe(false);
	});

	it('finds one compatible unified Retriever when a model wrapper feeds two Agents', () => {
		const execution = {
			getWorkflow: vi.fn(() => ({ id: 'workflow-1' })),
			getNode: vi.fn(() => ({ name: 'Context Saver - Agent Model' })),
			getChildNodes: vi.fn(() => [
				{ name: 'Agent A', type: '@n8n/n8n-nodes-langchain.agent' },
				{ name: 'Agent B', type: '@n8n/n8n-nodes-langchain.agent' },
			]),
			getParentNodes: vi.fn((agentName: string) =>
				agentName === 'Agent B'
					? [
							{
								type: 'n8n-nodes-context-optimizer.contextSaver',
								parameters: {
									resource: 'exactLookup',
									scope: '={{ $workflow.id }}',
									storageDirectory: 'C:\\context-saver',
									storageProvider: 'filesystem',
									encryptStorage: false,
								},
							},
						]
					: [],
			),
		} as unknown as ISupplyDataFunctions;

		expect(
			hasCompatibleRetriever(
				execution,
				filesystemExpectation.scope,
				filesystemExpectation.directory,
				filesystemExpectation.provider,
				filesystemExpectation.redisKeyPrefix,
				filesystemExpectation.encryptStorage,
			),
		).toBe(true);
	});
});
