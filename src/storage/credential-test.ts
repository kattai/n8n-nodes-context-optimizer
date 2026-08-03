import type { ICredentialTestFunction } from 'n8n-workflow';
import { createClient } from 'redis';

export const testContextSaverStorageApi: ICredentialTestFunction = async function (credential) {
	const data = credential.data ?? {};
	const url = String(data.redisUrl ?? '').trim();
	if (!url) return { status: 'Error', message: 'Redis URL is required' };

	const client = createClient({
		url,
		username: String(data.redisUsername ?? '').trim() || undefined,
		password: String(data.redisPassword ?? '').trim() || undefined,
		socket: { connectTimeout: 3000 },
	});
	try {
		await client.connect();
		await client.ping();
		return { status: 'OK', message: 'Redis connection succeeded' };
	} catch (error) {
		return {
			status: 'Error',
			message: `Redis connection failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	} finally {
		if (client.isOpen) await client.disconnect();
	}
};
