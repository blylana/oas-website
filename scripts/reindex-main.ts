import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createDatabase, FilesystemBridge } from '@tinacms/datalayer';
import mongodbLevel from 'mongodb-level';
import { BufferingGitProvider } from '../tina/github/git-provider';
import { getMongo } from '../tina/mongo';
import { activatePublishedIndex } from '../tina/content/published-index';
import { COLLECTION, DB_NAME, deleteNamespace, hasNamespace } from '../tina/content/tenant';

const ref = process.argv[2];
if (!ref || ref.startsWith('-')) {
	throw new Error('Usage: pnpm exec tsx scripts/reindex-main.ts <published-commit>');
}
if (process.env.TINA_PUBLIC_IS_LOCAL === 'true' || !process.env.MONGODB_URI) {
	throw new Error('A self-hosted MongoDB configuration is required');
}

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sha = git('rev-parse', '--verify', `${ref}^{commit}`);
if (git('diff', '--name-only', sha, '--', 'src/content/docs') ||
	git('ls-files', '--others', '--exclude-standard', '--', 'src/content/docs')) {
	throw new Error('The working tree docs must match the published commit');
}

const { schema, graphql, lookup } = JSON.parse(await readFile('tina/tina-lock.json', 'utf8'));
const { MongodbLevel } = mongodbLevel as typeof import('mongodb-level');
const adapter = new MongodbLevel({
	collectionName: COLLECTION, dbName: DB_NAME, mongoUri: process.env.MONGODB_URI,
});
const namespace = `published:${randomUUID()}`;
const index = createDatabase({
	databaseAdapter: adapter as unknown as Parameters<typeof createDatabase>[0]['databaseAdapter'],
	gitProvider: new BufferingGitProvider(),
	bridge: new FilesystemBridge(process.cwd()),
	namespace,
});

try {
	try {
		// Tina's indexer reads the serialized schema from this wrapper.
		const tinaSchema = { schema } as Parameters<typeof index.indexContent>[0]['tinaSchema'];
		const result = await index.indexContent({ graphQLSchema: graphql, tinaSchema, lookup });
		if (result?.warnings?.length) throw new Error(result.warnings.join('\n'));
		if (!await hasNamespace(namespace)) throw new Error('The staged index is empty');
	} catch (error) {
		await deleteNamespace(namespace);
		throw error;
	}
	// Keep the previous index available for requests already using it.
	await activatePublishedIndex(namespace, sha);
	console.log(`Activated the index for published commit ${sha}`);
} finally {
	try {
		await adapter.close();
	} finally {
		await getMongo().close();
	}
}
