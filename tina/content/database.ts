import { createLocalDatabase } from '@tinacms/datalayer';
import { getRequestContext } from '../editor/context';
import { getDb } from './tenant';

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true';
const useLocalDatabase =
	isLocal ||
	process.env.TINA_BUILD_STATIC === '1' ||
	!process.env.MONGODB_URI;
const localDatabase = useLocalDatabase ? createLocalDatabase() : null;

/**
 * The generated `databaseClient` imports this module once, at build/startup
 * time. Return a proxy that resolves the right namespace per request so every
 * user reads their own draft (or the published `main` index).
 */
const database = new Proxy(
	{} as Record<string, unknown>,
	{
		get(_target, property) {
			const namespace = getRequestContext()?.namespace ?? 'main';
			const db = useLocalDatabase ? localDatabase : getDb(namespace);
			const value = (db as unknown as Record<string | symbol, unknown>)[property];
			return typeof value === 'function' ? value.bind(db) : value;
		},
	},
);

export default database;