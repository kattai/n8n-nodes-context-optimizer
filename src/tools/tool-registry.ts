import { stableSerialize } from '../context/canonical-context';
import { estimateTokens } from '../core/token-estimator';

export interface RegisteredToolSchema {
	index: number;
	name: string;
	description: string;
	schemaText: string;
	estimatedTokens: number;
	tool: unknown;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function toolSchemaName(tool: unknown): string {
	const direct = record(tool);
	const fn = record(direct?.function);
	return String(direct?.name ?? fn?.name ?? direct?.toolName ?? '').trim();
}

export function toolSchemaDescription(tool: unknown): string {
	const direct = record(tool);
	const fn = record(direct?.function);
	return String(direct?.description ?? fn?.description ?? '').trim();
}

export class ToolRegistry {
	private readonly schemas = new Map<string, RegisteredToolSchema>();
	private readonly lastUsed = new Map<string, number>();
	private usageSequence = 0;

	register(tools: unknown[]): RegisteredToolSchema[] {
		return tools.map((tool, index) => {
			const name = toolSchemaName(tool) || `unnamed_tool_${index}`;
			const description = toolSchemaDescription(tool);
			const schemaText = stableSerialize(tool);
			const entry = {
				index,
				name,
				description,
				schemaText,
				estimatedTokens: estimateTokens(schemaText),
				tool,
			};
			this.schemas.set(name, entry);
			return entry;
		});
	}

	markUsed(names: Iterable<string>): void {
		for (const rawName of names) {
			const name = rawName.trim();
			if (!name || !this.schemas.has(name)) continue;
			this.lastUsed.set(name, ++this.usageSequence);
		}
	}

	recentlyUsed(limit = 8): string[] {
		return [...this.lastUsed.entries()]
			.sort((left, right) => right[1] - left[1])
			.slice(0, Math.max(0, limit))
			.map(([name]) => name);
	}
}
