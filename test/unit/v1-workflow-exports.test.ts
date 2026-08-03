import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflows = [
	'context-saver-v1-local-runtime.workflow.json',
	'context-saver-v1-chat-first-message.workflow.json',
];

describe('Context Saver 1.0 workflow exports', () => {
	for (const filename of workflows) {
		it(`keeps ${filename} importable and synthetic`, async () => {
			const path = resolve(process.cwd(), 'examples', 'workflows', filename);
			const workflow = JSON.parse(await readFile(path, 'utf8')) as {
				name: string;
				nodes: Array<{ type: string; typeVersion?: number; parameters?: Record<string, unknown> }>;
			};
			expect(workflow.name).toContain('Context Saver 1.0');
			expect(workflow.nodes.length).toBeGreaterThan(2);
			expect(JSON.stringify(workflow)).not.toMatch(/googlePalmApi|openAiApi|anthropicApi|whatsAppApi/iu);
			expect(
				workflow.nodes.some(
					(node) =>
						node.type === 'n8n-nodes-context-optimizer.contextSaver' &&
						node.parameters?.resource === 'dataOptimization',
				),
			).toBe(true);
		});
	}

	it('uses only the unified Context Saver type in every published example', async () => {
		const directory = resolve(process.cwd(), 'examples', 'workflows');
		const filenames = (await readdir(directory)).filter((filename) => filename.endsWith('.json'));
		for (const filename of filenames) {
			const workflow = JSON.parse(await readFile(resolve(directory, filename), 'utf8')) as {
				nodes: Array<{ type: string; parameters?: Record<string, unknown> }>;
			};
			const contextSaverNodes = workflow.nodes.filter((node) =>
				node.type.startsWith('n8n-nodes-context-optimizer.'),
			);
			expect(
				contextSaverNodes.map((node) => ({ type: node.type, resource: node.parameters?.resource })),
				filename,
			).toEqual(
				contextSaverNodes.map(() => ({
					type: 'n8n-nodes-context-optimizer.contextSaver',
					resource: expect.stringMatching(
						/^(agentModel|dataOptimization|sessionMemory|agentHandoff|contextStorage|exactLookup|savingsReport)$/u,
					),
				})),
			);
		}
	});
});
