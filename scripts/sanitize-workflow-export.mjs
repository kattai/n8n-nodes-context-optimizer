import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const [source, destinationDirectory] = process.argv.slice(2);
if (!source || !destinationDirectory) {
	throw new Error('Usage: node scripts/sanitize-workflow-export.mjs <source> <destination-directory>');
}

const workflow = JSON.parse(await readFile(resolve(source), 'utf8'));
for (const node of workflow.nodes ?? []) delete node.credentials;
delete workflow.pinData;
workflow.active = false;

const destination = resolve(destinationDirectory, basename(source));
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
console.log(destination);
