import { createDatabase, createLocalDatabase } from '@tinacms/datalayer';
import { GitHubProvider } from 'tinacms-gitprovider-github';
import redisLevel from 'upstash-redis-level';

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true';

const owner = process.env.GITHUB_OWNER;
const repo = process.env.GITHUB_REPO;
const branch = process.env.GITHUB_BRANCH || 'tina';
const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
const { RedisLevel } = redisLevel as typeof import('upstash-redis-level');

export default isLocal
	? createLocalDatabase()
	: createDatabase({
			gitProvider: new GitHubProvider({
				branch,
				owner: owner!,
				repo: repo!,
				token: token!,
			}),
			databaseAdapter: new RedisLevel<string, Record<string, unknown>>({
				redis: {
				url:
					process.env.KV_REST_API_URL ||
					process.env.UPSTASH_REDIS_REST_URL ||
					'http://localhost:8079',
				token:
					process.env.KV_REST_API_TOKEN ||
					process.env.UPSTASH_REDIS_REST_TOKEN ||
					'example_token',
				},
			}),
			namespace: branch,
		});
