import { readFile } from 'node:fs/promises';
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
				workflow.nodes.some((node) => node.type === 'n8n-nodes-context-optimizer.contextOptimizer'),
			).toBe(true);
		});
	}
});
