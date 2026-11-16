import { createDatabase, createLocalDatabase } from '@tinacms/datalayer';
import { GitHubProvider } from 'tinacms-gitprovider-github';
import mongodbLevel from 'mongodb-level';

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true';

const owner = process.env.GITHUB_OWNER;
const repo = process.env.GITHUB_REPO;
const branch = process.env.GITHUB_BRANCH || 'tina';
const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
const { MongodbLevel } = mongodbLevel as typeof import('mongodb-level');

export default isLocal
	? createLocalDatabase()
	: createDatabase({
			gitProvider: new GitHubProvider({
				branch,
				owner: owner!,
				repo: repo!,
				token: token!,
			}),
			databaseAdapter: new MongodbLevel<string, Record<string, any>>({
				collectionName: `tinacms-${branch}`,
				dbName: 'tinacms',
				mongoUri: process.env.MONGODB_URI as string,
			}),
			namespace: branch,
		});
