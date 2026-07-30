import type { CompressorResult } from './types';

const ansiPattern = new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, 'g');

export function compressLogs(content: string): CompressorResult {
	const lines = content.replace(ansiPattern, '').replace(/\r\n?/g, '\n').split('\n');
	const compressed: string[] = [];
	let previous = '';
	let count = 0;
	const flush = () => {
		if (!previous) return;
		compressed.push(count > 1 ? `${previous} ×${count}` : previous);
	};
	for (const raw of lines) {
		const line = raw.trimEnd();
		if (!line) continue;
		if (line === previous) {
			count++;
			continue;
		}
		flush();
		previous = line;
		count = 1;
	}
	flush();
	return {
		content: compressed.join('\n'),
		strategies: ['remove-ansi', 'collapse-consecutive-log-lines'],
		format: 'logs',
	};
}
