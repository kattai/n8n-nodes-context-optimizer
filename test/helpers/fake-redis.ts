import type { RedisClientLike } from '../../src/storage/redis-store';

interface Entry {
	fields?: Map<string, string>;
	value?: string;
	expiresAt?: number;
}

export class FakeRedisClient implements RedisClientLike {
	isOpen = true;
	private readonly entries = new Map<string, Entry>();

	async connect(): Promise<void> {
		this.isOpen = true;
	}

	private live(key: string): Entry | undefined {
		const entry = this.entries.get(key);
		if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
			this.entries.delete(key);
			return undefined;
		}
		return entry;
	}

	async set(
		key: string,
		value: string,
		options?: { NX?: boolean; PX?: number },
	): Promise<string | null> {
		if (options?.NX && this.live(key)) return null;
		this.entries.set(key, {
			value,
			...(options?.PX ? { expiresAt: Date.now() + options.PX } : {}),
		});
		return 'OK';
	}

	async eval(
		_script: string,
		options: { keys: string[]; arguments: string[] },
	): Promise<number> {
		const [key] = options.keys;
		const [owner] = options.arguments;
		if (!key || this.live(key)?.value !== owner) return 0;
		this.entries.delete(key);
		return 1;
	}

	async hGet(key: string, field: string): Promise<string | null> {
		return this.live(key)?.fields?.get(field) ?? null;
	}

	async hSet(key: string, values: Record<string, string>): Promise<number> {
		const entry = this.live(key) ?? { fields: new Map<string, string>() };
		entry.fields ??= new Map<string, string>();
		for (const [field, value] of Object.entries(values)) entry.fields.set(field, value);
		this.entries.set(key, entry);
		return Object.keys(values).length;
	}

	async expire(key: string, seconds: number): Promise<number> {
		const entry = this.live(key);
		if (!entry) return 0;
		entry.expiresAt = Date.now() + seconds * 1000;
		return 1;
	}

	async del(key: string): Promise<number> {
		return this.entries.delete(key) ? 1 : 0;
	}

	async *scanIterator(options: { MATCH: string; COUNT: number }): AsyncIterable<string> {
		void options.COUNT;
		const pattern = new RegExp(`^${options.MATCH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')}$`);
		for (const key of this.entries.keys()) {
			if (this.live(key) && pattern.test(key)) yield key;
		}
	}

	async ttl(key: string): Promise<number> {
		const entry = this.live(key);
		if (!entry) return -2;
		if (entry.expiresAt === undefined) return -1;
		return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
	}

	peekHash(key: string, field: string): string | undefined {
		return this.live(key)?.fields?.get(field);
	}

	setHashField(key: string, field: string, value: string): void {
		const entry = this.live(key) ?? { fields: new Map<string, string>() };
		entry.fields ??= new Map<string, string>();
		entry.fields.set(field, value);
		this.entries.set(key, entry);
	}
}
