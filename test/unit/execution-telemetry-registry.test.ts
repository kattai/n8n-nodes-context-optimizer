import { beforeEach, describe, expect, it } from 'vitest';
import {
	clearAllExecutionTelemetry,
	getExecutionTelemetry,
	recordExecutionTelemetry,
	summarizeExecutionTelemetry,
} from '../../src/analytics/execution-telemetry-registry';

beforeEach(clearAllExecutionTelemetry);

describe('execution component telemetry', () => {
	it('merges calls per node and calculates net savings after retrieval overhead', () => {
		recordExecutionTelemetry({
			executionId: 'synthetic-execution',
			nodeName: 'Data Optimizer',
			component: 'data_optimizer',
			recordedAt: new Date().toISOString(),
			tokensBefore: 1000,
			tokensAfter: 400,
		});
		recordExecutionTelemetry({
			executionId: 'synthetic-execution',
			nodeName: 'Data Optimizer',
			component: 'data_optimizer',
			recordedAt: new Date().toISOString(),
			tokensBefore: 500,
			tokensAfter: 200,
		});
		recordExecutionTelemetry({
			executionId: 'synthetic-execution',
			nodeName: 'Exact Lookup',
			component: 'exact_lookup',
			recordedAt: new Date().toISOString(),
			overheadTokens: 100,
		});

		const records = getExecutionTelemetry('synthetic-execution');
		expect(records.find((record) => record.component === 'data_optimizer')?.calls).toBe(2);
		expect(summarizeExecutionTelemetry(records)).toMatchObject({
			componentsMeasured: 2,
			callsMeasured: 3,
			grossSavedTokens: 900,
			netSavedTokens: 800,
		});
	});
});
