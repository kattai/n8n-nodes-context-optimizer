import { describe, expect, it } from 'vitest';
import { buildIsolationScope } from '../../src/storage/isolation-scope';

describe('resource isolation scope', () => {
	it('keeps legacy scope unchanged when session and owner are absent', () => {
		expect(buildIsolationScope('workflow-a')).toBe('workflow-a');
	});

	it('changes when either session or owner changes', () => {
		const first = buildIsolationScope('workflow-a', 'session-1', 'user-1');
		expect(buildIsolationScope('workflow-a', 'session-2', 'user-1')).not.toBe(first);
		expect(buildIsolationScope('workflow-a', 'session-1', 'user-2')).not.toBe(first);
		expect(buildIsolationScope('workflow-b', 'session-1', 'user-1')).not.toBe(first);
	});
});
