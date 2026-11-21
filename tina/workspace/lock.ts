import { randomUUID } from 'node:crypto';
import { appDb } from '../mongo';
import { HttpError } from '../http-error';

const COLLECTION = 'locks';
// Fork creation can poll GitHub for a while; keep the lock longer than the
// slowest first-save path so two saves cannot overlap.
const TTL_MS = 5 * 60 * 1000;

type LockDoc = { _id: string; owner: string; expiresAt: Date };

let indexesReady: Promise<void> | null = null;

function collection() {
	return appDb().collection<LockDoc>(COLLECTION);
}

function ensureIndexes() {
	indexesReady ??= collection()
		.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
		.then(() => undefined);
	return indexesReady;
}

export async function acquireLock(userId: string): Promise<string> {
	await ensureIndexes();
	const owner = randomUUID();
	const now = new Date();
	const doc: LockDoc = { _id: userId, owner, expiresAt: new Date(now.getTime() + TTL_MS) };

	try {
		await collection().insertOne(doc);
		return owner;
	} catch (error) {
		if ((error as { code?: number }).code !== 11000) throw error;
	}

	// The existing lock may already be expired; drop it and try once more.
	await collection().deleteOne({ _id: userId, expiresAt: { $lt: now } });
	try {
		await collection().insertOne(doc);
		return owner;
	} catch (error) {
		if ((error as { code?: number }).code === 11000) {
			throw new HttpError(409, 'workspace_busy', 'Another save or submit is already running');
		}
		throw error;
	}
}

export async function releaseLock(userId: string, owner: string) {
	await collection().deleteOne({ _id: userId, owner });
}

export async function withLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
	const owner = await acquireLock(userId);
	try {
		return await fn();
	} finally {
		await releaseLock(userId, owner);
	}
}