export type ContextSaverComponent =
	| 'agent_handoff'
	| 'data_optimizer'
	| 'exact_lookup'
	| 'session_memory'
	| 'context_storage';

export interface ExecutionTelemetryRecord {
	executionId: string;
	nodeName: string;
	component: ContextSaverComponent;
	recordedAt: string;
	calls?: number;
	tokensBefore?: number;
	tokensAfter?: number;
	overheadTokens?: number;
	qualityFallbacks?: number;
	selectedProfile?: string;
	effectiveProfile?: string;
	resourceIds?: string[];
	diagnostics?: string[];
}

const MAX_EXECUTIONS = 200;
const MAX_RECORDS_PER_EXECUTION = 200;
const RECORD_TTL_MS = 24 * 60 * 60 * 1000;
const registry = new Map<string, Map<string, ExecutionTelemetryRecord>>();

function finite(value: number | undefined): number {
	return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function recordKey(record: Pick<ExecutionTelemetryRecord, 'component' | 'nodeName'>): string {
	return `${record.component}\0${record.nodeName}`;
}

function merge(
	previous: ExecutionTelemetryRecord,
	current: ExecutionTelemetryRecord,
): ExecutionTelemetryRecord {
	return {
		...current,
		calls: (previous.calls ?? 1) + (current.calls ?? 1),
		tokensBefore: finite(previous.tokensBefore) + finite(current.tokensBefore),
		tokensAfter: finite(previous.tokensAfter) + finite(current.tokensAfter),
		overheadTokens: finite(previous.overheadTokens) + finite(current.overheadTokens),
		qualityFallbacks: finite(previous.qualityFallbacks) + finite(current.qualityFallbacks),
		selectedProfile: current.selectedProfile ?? previous.selectedProfile,
		effectiveProfile: current.effectiveProfile ?? previous.effectiveProfile,
		resourceIds: [...new Set([...(previous.resourceIds ?? []), ...(current.resourceIds ?? [])])].slice(
			0,
			100,
		),
		diagnostics: [...new Set([...(previous.diagnostics ?? []), ...(current.diagnostics ?? [])])].slice(
			0,
			50,
		),
	};
}

function prune(now = Date.now()): void {
	for (const [executionId, records] of registry) {
		for (const [key, record] of records) {
			if (now - Date.parse(record.recordedAt) > RECORD_TTL_MS) records.delete(key);
		}
		if (records.size === 0) registry.delete(executionId);
	}
	while (registry.size > MAX_EXECUTIONS) {
		const first = registry.keys().next().value as string | undefined;
		if (!first) break;
		registry.delete(first);
	}
}

export function recordExecutionTelemetry(record: ExecutionTelemetryRecord): void {
	prune();
	const records = registry.get(record.executionId) ?? new Map<string, ExecutionTelemetryRecord>();
	const key = recordKey(record);
	const previous = records.get(key);
	records.set(key, previous ? merge(previous, record) : { ...record, calls: record.calls ?? 1 });
	while (records.size > MAX_RECORDS_PER_EXECUTION) {
		const first = records.keys().next().value as string | undefined;
		if (!first) break;
		records.delete(first);
	}
	registry.set(record.executionId, records);
	prune();
}

export function getExecutionTelemetry(executionId: string): ExecutionTelemetryRecord[] {
	prune();
	return [...(registry.get(executionId)?.values() ?? [])].sort((left, right) =>
		`${left.component}:${left.nodeName}`.localeCompare(`${right.component}:${right.nodeName}`),
	);
}

export function clearExecutionComponentTelemetry(executionId: string): void {
	registry.delete(executionId);
}

export function clearAllExecutionTelemetry(): void {
	registry.clear();
}

export function summarizeExecutionTelemetry(records: ExecutionTelemetryRecord[]) {
	const tokensBefore = records.reduce((sum, record) => sum + finite(record.tokensBefore), 0);
	const tokensAfter = records.reduce((sum, record) => sum + finite(record.tokensAfter), 0);
	const overheadTokens = records.reduce((sum, record) => sum + finite(record.overheadTokens), 0);
	const grossSavedTokens = Math.max(0, tokensBefore - tokensAfter);
	const netSavedTokens = grossSavedTokens - overheadTokens;
	return {
		componentsMeasured: records.length,
		callsMeasured: records.reduce((sum, record) => sum + (record.calls ?? 1), 0),
		tokensBefore,
		tokensAfter,
		overheadTokens,
		grossSavedTokens,
		netSavedTokens,
		netSavedPercent:
			tokensBefore === 0 ? 0 : Number(((netSavedTokens / tokensBefore) * 100).toFixed(2)),
		qualityFallbacks: records.reduce((sum, record) => sum + finite(record.qualityFallbacks), 0),
	};
}
