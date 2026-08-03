import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { runSyntheticBossBenchmark } = require('../dist/src/benchmarks/synthetic-bosses.js');
const result = await runSyntheticBossBenchmark();
const root = resolve(import.meta.dirname, '..');
const outputDirectory = join(root, 'benchmarks', 'results');
const markdown = `# Context Saver 1.0 synthetic boss benchmark

Status: **${result.passed ? 'PASS' : 'FAIL'}**

| Scenario | Reduction | Quality gate |
|---|---:|---:|
| Long context | ${result.longContext.reductionPercent}% | ${result.longContext.currentMessageExact && result.longContext.protectedFactsExact ? '100%' : 'FAIL'} |
| 14 tools, clear intent | ${result.toolHeavy.clearIntentReductionPercent}% | ${result.toolHeavy.selectedTools.includes('calendar_lookup') ? '100%' : 'FAIL'} |
| 14 tools, ambiguous intent | 0% by design | ${result.toolHeavy.ambiguousKeptAll ? '100%' : 'FAIL'} |
| Two-agent handoff | ${result.multiAgent.reductionPercent}% | ${result.multiAgent.objectiveExact && result.multiAgent.factExact ? '100%' : 'FAIL'} |

Generated fictional data only. No provider or external API call was made.
`;
await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, 'context-saver-v1-bosses.json'), `${JSON.stringify(result, null, 2)}\n`);
await writeFile(join(outputDirectory, 'context-saver-v1-bosses.md'), markdown);
console.log(markdown);
if (!result.passed) process.exitCode = 1;
