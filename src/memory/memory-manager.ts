/* eslint-disable @n8n/community-nodes/require-node-api-error -- Memory core has no n8n execution context; node adapter wraps errors. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import { stableSerialize } from '../context/canonical-context';
import { estimateTokens } from '../core/token-estimator';
import { updateVersionedFacts } from './fact-versioning';
import { validateIncrementalSummary } from './incremental-summary';
import type {
	ArchivedResourceReference,
	BuildMemoryContextInput,
	BuildMemoryContextResult,
	MemoryMessage,
	MemoryMessageInput,
	MemorySession,
	ProtectedMemoryKind,
	UpdateMemorySessionInput,
	UpdateMemorySessionResult,
} from './types';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const sessionLocks = new Map<string, Promise<void>>();

export class MemorySessionNotFoundError extends Error {
	constructor(sessionKey: string, scope: string) {
		super(`Memory session not found for sessionKey "${sessionKey}" in scope "${scope}"`);
		this.name = 'MemorySessionNotFoundError';
	}
}

export function defaultMemoryDirectory(): string {
	const userFolder = process.env.N8N_USER_FOLDER?.trim() || join(homedir(), '.n8n');
	return join(userFolder, 'context-optimizer', 'memory');
}

function assertKey(value: string, name: 'scope' | 'sessionKey'): string {
	const normalized = value.trim();
	if (!normalized) throw new Error(`${name} is required`);
	if (normalized.length > 512) throw new Error(`${name} exceeds 512 characters`);
	return normalized;
}

function memoryId(sessionKey: string, scope: string): string {
	return `mem_${createHash('sha256').update(`${scope}\0${sessionKey}`).digest('hex').slice(0, 32)}`;
}

function classifyProtectedKind(message: MemoryMessageInput): ProtectedMemoryKind | undefined {
	if (message.kind) return message.kind;
	if (message.protected === true) return 'decision';
	const text = message.content;
	if (/\b(corre[cç][aã]o|corrigindo|na verdade|correction)\b/iu.test(text)) return 'correction';
	if (/\b(pendente|ainda falta|pend[eê]ncia|pending|todo)\b/iu.test(text)) return 'pending';
	if (/\b(erro ativo|falha ativa|failed|active error)\b/iu.test(text)) return 'active_failure';
	if (/\b(decis[aã]o|decidido|confirmado|agreed|decision)\b/iu.test(text)) return 'decision';
	return undefined;
}

function normalizeMessage(message: MemoryMessageInput): MemoryMessage {
	const content = String(message.content ?? '').trim();
	if (!content) throw new Error('Memory message content is required');
	const role = message.role;
	if (!['assistant', 'system', 'tool', 'user'].includes(role)) {
		throw new Error(`Unsupported memory message role: ${String(role)}`);
	}
	const kind = classifyProtectedKind(message);
	return {
		id: message.id?.trim() || `msg_${randomUUID()}`,
		role,
		content,
		createdAt: message.createdAt || new Date().toISOString(),
		...(kind ? { kind, protected: true } : {}),
		...(message.metadata ? { metadata: message.metadata } : {}),
	};
}

function normalizeResource(
	value: string | { resourceId: string; description?: string },
	now: string,
): ArchivedResourceReference {
	const resourceId = (typeof value === 'string' ? value : value.resourceId).trim();
	if (!/^ctx_[a-f0-9]{24}$/.test(resourceId)) {
		throw new Error(`Invalid archived resource ID: ${resourceId}`);
	}
	return {
		resourceId,
		...(typeof value === 'object' && value.description?.trim()
			? { description: value.description.trim() }
			: {}),
		addedAt: now,
	};
}

function createSession(
	sessionKey: string,
	scope: string,
	now: string,
	ttlSeconds: number,
	recentWindow: number,
): MemorySession {
	return {
		storageVersion: 1,
		sessionKey,
		scope,
		revision: 0,
		createdAt: now,
		updatedAt: now,
		expiresAt: new Date(Date.parse(now) + ttlSeconds * 1000).toISOString(),
		recentWindow,
		pinnedFacts: {},
		structuredState: {},
		recentMessages: [],
		protectedItems: [],
		archivedEvents: [],
		archivedResources: [],
	};
}

export class FileSystemMemoryManager {
	private readonly root: string;

	constructor(
		rootDirectory = defaultMemoryDirectory(),
		private readonly maxSessionBytes = 2 * 1024 * 1024,
	) {
		this.root = resolve(rootDirectory);
	}

	private path(sessionKey: string, scope: string): string {
		const candidate = resolve(join(this.root, `${memoryId(sessionKey, scope)}.json.gz`));
		if (!candidate.startsWith(`${this.root}${sep}`)) {
			throw new Error('Memory path escapes storage directory');
		}
		return candidate;
	}

	private async readOptional(
		sessionKey: string,
		scope: string,
	): Promise<MemorySession | undefined> {
		const path = this.path(sessionKey, scope);
		try {
			const session = JSON.parse(
				(await gunzipAsync(await readFile(path))).toString('utf8'),
			) as MemorySession;
			if (session.sessionKey !== sessionKey || session.scope !== scope) {
				throw new Error('Memory session identity check failed');
			}
			if (Date.parse(session.expiresAt) <= Date.now()) {
				await unlink(path).catch(() => undefined);
				return undefined;
			}
			return session;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
			throw error;
		}
	}

	private async writeAtomic(session: MemorySession): Promise<void> {
		const serialized = `${JSON.stringify(session)}\n`;
		if (Buffer.byteLength(serialized, 'utf8') > this.maxSessionBytes) {
			throw new Error(`Memory session exceeds maximum size of ${this.maxSessionBytes} bytes`);
		}
		const path = this.path(session.sessionKey, session.scope);
		await mkdir(dirname(path), { recursive: true });
		const temporary = `${path}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, await gzipAsync(Buffer.from(serialized, 'utf8')), { flag: 'wx' });
			await rename(temporary, path);
		} catch (error) {
			await unlink(temporary).catch(() => undefined);
			throw error;
		}
	}

	private async withSessionLock<T>(path: string, run: () => Promise<T>): Promise<T> {
		const previous = sessionLocks.get(path) ?? Promise.resolve();
		let release = (): void => undefined;
		const gate = new Promise<void>((resolveGate) => {
			release = resolveGate;
		});
		const queued = previous.then(() => gate);
		sessionLocks.set(path, queued);
		await previous;
		try {
			return await run();
		} finally {
			release();
			if (sessionLocks.get(path) === queued) sessionLocks.delete(path);
		}
	}

	async updateSession(input: UpdateMemorySessionInput): Promise<UpdateMemorySessionResult> {
		const sessionKey = assertKey(input.sessionKey, 'sessionKey');
		const scope = assertKey(input.scope, 'scope');
		const ttlSeconds = input.ttlSeconds ?? 7 * 24 * 3600;
		if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
			throw new Error('ttlSeconds must be greater than zero');
		}
		const recentWindow = Math.min(100, Math.max(1, Math.floor(input.recentWindow ?? 6)));
		const summaryMaximumTokens = Math.min(
			32_000,
			Math.max(100, Math.floor(input.summaryMaximumTokens ?? 4_000)),
		);
		const path = this.path(sessionKey, scope);

		return await this.withSessionLock(path, async () => {
			const now = new Date().toISOString();
			const session =
				(await this.readOptional(sessionKey, scope)) ??
				createSession(sessionKey, scope, now, ttlSeconds, recentWindow);
			const warnings: string[] = [];
			session.recentWindow = recentWindow;
			session.pinnedFacts = updateVersionedFacts(session.pinnedFacts, input.pinnedFacts ?? {}, now);
			if (input.structuredState !== undefined) {
				session.structuredState =
					input.stateMode === 'replace'
						? { ...input.structuredState }
						: { ...session.structuredState, ...input.structuredState };
			}

			const existingMessageIds = new Set([
				...session.recentMessages.map((message) => message.id),
				...session.archivedEvents.map((event) => event.message.id),
			]);
			for (const rawMessage of input.messages ?? []) {
				const message = normalizeMessage(rawMessage);
				if (existingMessageIds.has(message.id)) continue;
				existingMessageIds.add(message.id);
				session.recentMessages.push(message);
				if (message.protected) {
					session.protectedItems = [
						...session.protectedItems.filter((item) => item.id !== message.id),
						message,
					];
				}
			}

			const overflow = session.recentMessages.splice(
				0,
				Math.max(0, session.recentMessages.length - recentWindow),
			);
			for (const message of overflow) {
				session.archivedEvents.push({
					id: `event_${message.id}`,
					type: 'message',
					message,
					archivedAt: now,
				});
			}

			if (input.summaryCandidate !== undefined) {
				const summaryResult = validateIncrementalSummary(
					input.summaryCandidate,
					session.revision,
					now,
					input.summaryBasedOnRevision,
					(input.summaryRequiredValues ?? []).map(String),
					summaryMaximumTokens,
				);
				if (summaryResult.summary) session.incrementalSummary = summaryResult.summary;
				if (summaryResult.warning) warnings.push(summaryResult.warning);
			}

			const resourceById = new Map(
				session.archivedResources.map((resource) => [resource.resourceId, resource]),
			);
			for (const rawResource of input.archivedResources ?? []) {
				const resource = normalizeResource(rawResource, now);
				resourceById.set(resource.resourceId, resource);
			}
			session.archivedResources = [...resourceById.values()];
			session.revision += 1;
			session.updatedAt = now;
			session.expiresAt = new Date(Date.parse(now) + ttlSeconds * 1000).toISOString();
			await this.writeAtomic(session);
			return { session, warnings };
		});
	}

	async buildContext(input: BuildMemoryContextInput): Promise<BuildMemoryContextResult> {
		const sessionKey = assertKey(input.sessionKey, 'sessionKey');
		const scope = assertKey(input.scope, 'scope');
		const session = await this.readOptional(sessionKey, scope);
		if (!session) throw new MemorySessionNotFoundError(sessionKey, scope);
		const protectedIds = new Set(session.protectedItems.map((item) => item.id));
		const recentMessages = session.recentMessages
			.filter((message) => !protectedIds.has(message.id))
			.map(({ role, content, createdAt }) => ({ role, content, createdAt }));
		const currentFacts = Object.fromEntries(
			Object.entries(session.pinnedFacts).map(([key, fact]) => [key, fact.value]),
		);
		const contextValue = {
			memoryVersion: 1,
			currentFacts,
			structuredState: session.structuredState,
			protectedItems: session.protectedItems.map(({ kind, role, content, createdAt }) => ({
				kind,
				role,
				content,
				createdAt,
			})),
			...(session.incrementalSummary
				? { incrementalSummary: session.incrementalSummary.text }
				: {}),
			recentMessages,
			archivedResources: session.archivedResources.map(({ resourceId, description }) => ({
				resourceId,
				...(description ? { description } : {}),
			})),
		};
		const context = stableSerialize(contextValue);
		return {
			sessionKey,
			scope,
			revision: session.revision,
			context,
			estimatedTokens: estimateTokens(context),
			included: {
				currentFacts: Object.keys(currentFacts).length,
				stateFields: Object.keys(session.structuredState).length,
				protectedItems: session.protectedItems.length,
				recentMessages: recentMessages.length,
				archivedResources: session.archivedResources.length,
				summary: session.incrementalSummary !== undefined,
			},
			archivedEventCount: session.archivedEvents.length,
		};
	}

	async inspectSession(sessionKeyInput: string, scopeInput: string): Promise<MemorySession> {
		const sessionKey = assertKey(sessionKeyInput, 'sessionKey');
		const scope = assertKey(scopeInput, 'scope');
		const session = await this.readOptional(sessionKey, scope);
		if (!session) throw new MemorySessionNotFoundError(sessionKey, scope);
		return session;
	}

	async deleteSession(sessionKeyInput: string, scopeInput: string): Promise<boolean> {
		const sessionKey = assertKey(sessionKeyInput, 'sessionKey');
		const scope = assertKey(scopeInput, 'scope');
		const path = this.path(sessionKey, scope);
		return await this.withSessionLock(path, async () => {
			try {
				await unlink(path);
				return true;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
				throw error;
			}
		});
	}

	async purgeExpired(now = new Date()): Promise<number> {
		await mkdir(this.root, { recursive: true });
		const entries = (await readdir(this.root)).filter((entry) =>
			/^mem_[a-f0-9]{32}\.json\.gz$/.test(entry),
		);
		let purged = 0;
		for (const entry of entries) {
			const path = resolve(join(this.root, entry));
			try {
				const session = JSON.parse(
					(await gunzipAsync(await readFile(path))).toString('utf8'),
				) as MemorySession;
				if (Date.parse(session.expiresAt) <= now.getTime()) {
					await unlink(path);
					purged++;
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
			}
		}
		return purged;
	}
}
