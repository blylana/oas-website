import { createDatabase, createLocalDatabase } from '@tinacms/datalayer';
import mongodbLevel from 'mongodb-level';
import { appDb } from '../mongo';
import { BufferingGitProvider } from '../github/git-provider';

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true';
const { MongodbLevel } = mongodbLevel as typeof import('mongodb-level');

export const COLLECTION = 'tinacms';
export const DB_NAME = 'tinacms';
export const SEP = '\x1d';

let sharedLevel: any;

function getLevel() {
	if (!sharedLevel) {
		if (!process.env.MONGODB_URI) {
			throw new Error('MONGODB_URI is required');
		}
		sharedLevel = new MongodbLevel({
			collectionName: COLLECTION,
			dbName: DB_NAME,
			mongoUri: process.env.MONGODB_URI,
		});
	}
	return sharedLevel;
}

let localDb: unknown;

function makeDatabase(namespace: string) {
	return createDatabase({
		gitProvider: new BufferingGitProvider(),
		databaseAdapter: getLevel(),
		namespace,
	});
}

type CacheEntry = { db: ReturnType<typeof makeDatabase>; used: number };

const cache = new Map<string, CacheEntry>();
const MAX_CACHED = 100;
const IDLE_MS = 10 * 60 * 1000;

export function getDb(namespace = 'main') {
	if (isLocal) {
		localDb ??= createLocalDatabase();
		return localDb as ReturnType<typeof makeDatabase>;
	}

	const now = Date.now();
	const hit = cache.get(namespace);
	if (hit) {
		hit.used = now;
		return hit.db;
	}

	for (const [key, entry] of cache) {
		if (now - entry.used > IDLE_MS) cache.delete(key);
	}
	if (cache.size >= MAX_CACHED) {
		let oldestKey: string | undefined;
		let oldest = Number.POSITIVE_INFINITY;
		for (const [key, entry] of cache) {
			if (entry.used < oldest) {
				oldest = entry.used;
				oldestKey = key;
			}
		}
		if (oldestKey) cache.delete(oldestKey);
	}

	const db = makeDatabase(namespace);
	cache.set(namespace, { db, used: now });
	return db;
}

export function invalidateDb(namespace: string) {
	cache.delete(namespace);
}

export function contentPrefix(namespace: string) {
	return `${SEP}_content${SEP}${SEP}${namespace}${SEP}`;
}

export function metaPrefix(namespace: string) {
	return `${SEP}_metadata${SEP}${SEP}${namespace}${SEP}`;
}

function keyRange(prefix: string) {
	return { $gte: prefix, $lt: `${prefix}\uffff` };
}

export async function hasNamespace(namespace: string) {
	if (isLocal) return false;
	const doc = await appDb()
		.collection(COLLECTION)
		.findOne({ key: keyRange(contentPrefix(namespace)) }, { projection: { _id: 1 } });
	return Boolean(doc);
}

export async function hasDraft(userId: string) {
	return hasNamespace(`draft:${userId}`);
}

function convertKey(key: string, from: string, to: string) {
	const contentFrom = contentPrefix(from);
	if (key.startsWith(contentFrom)) {
		return contentPrefix(to) + key.slice(contentFrom.length);
	}
	const metaFrom = metaPrefix(from);
	if (key.startsWith(metaFrom)) {
		return metaPrefix(to) + key.slice(metaFrom.length);
	}
	return key;
}

export async function cloneDraft(userId: string, from = 'main') {
	if (isLocal) return false;
	const namespace = `draft:${userId}`;
	if (await hasNamespace(namespace)) return false;

	const collection = appDb().collection(COLLECTION);
	const [content, metadata] = await Promise.all([
		collection.find({ key: keyRange(contentPrefix(from)) }).toArray(),
		collection.find({ key: keyRange(metaPrefix(from)) }).toArray(),
	]);
	const docs = [...content, ...metadata].map((doc) => ({
		key: convertKey(doc.key as string, from, namespace),
		value: doc.value,
	}));
	if (!docs.length) {
		throw new Error('The published index is empty; build the site and run scripts/reindex-main.ts');
	}
	try {
		await collection.insertMany(docs, { ordered: false });
	} catch (error) {
		// Do not leave a half-cloned draft behind.
		await deleteNamespace(namespace);
		throw error;
	}
	invalidateDb(namespace);
	return true;
}

export async function deleteNamespace(namespace: string) {
	if (isLocal) return;
	const collection = appDb().collection(COLLECTION);
	await collection.deleteMany({ key: keyRange(contentPrefix(namespace)) });
	await collection.deleteMany({ key: keyRange(metaPrefix(namespace)) });
	invalidateDb(namespace);
}

export async function deleteDraft(userId: string) {
	await deleteNamespace(`draft:${userId}`);
}
