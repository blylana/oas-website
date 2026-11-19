import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TinaNodeBackend, LocalBackendAuthProvider } from '@tinacms/datalayer';
import databaseClient from './tina/__generated__/databaseClient';
import { ClerkBackendAuthenticationForAstro } from './tina/clerk-auth';
import { getRequestContext, requestContext, type RequestContext } from './tina/context';
import { hasDraft } from './tina/tenant';
import { getGithubIdentity, GithubAuthError } from './tina/github-identity';
import { withLock } from './tina/lock';
import { enforceRateLimit } from './tina/ratelimit';
import { prepareWrite } from './tina/write-context';
import { flushCommit } from './tina/commit';
import { HttpError } from './tina/http-error';
import { createTinaApi } from './tina/api';
import { startSweep } from './tina/sweep';
import { logger } from './tina/logger';

// Astro's generated entry can start its own listener unless this is disabled
// before importing it. Express owns the production listener in this setup.
// Astro 不自己监听端口，而是把服务器控制权交给Express
process.env.ASTRO_NODE_AUTOSTART = 'disabled';
const { handler: astroHandler } = await import('./dist/server/entry.mjs');

const app = express();
const port = Number(process.env.PORT || 4321);
const clientDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist/client');

// 生成请求 ID
function requestIdFrom(req: express.Request) {
	const candidate = req.header('x-request-id');
	return candidate && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : randomUUID();
}

app.use((req, res, next) => {
	const requestId = requestIdFrom(req);
	const context: RequestContext = { requestId, buffer: [] };
	const startedAt = performance.now();
	let completed = false;

	res.setHeader('x-request-id', requestId);
	res.once('finish', () => {
		completed = true;
		logger.info('http.request.completed', {
			requestId,
			method: req.method,
			path: req.path,
			status: res.statusCode,
			...(context.userId ? { userId: context.userId } : {}),
			...(context.login ? { githubLogin: context.login } : {}),
			durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
		});
	});
	res.once('close', () => {
		if (!completed) {
			logger.warn('http.request.aborted', {
				requestId,
				method: req.method,
				path: req.path,
				durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
			});
		}
	});

	requestContext.run(context, next);
});

// 允许 Express 解析 JSON 请求体，最大 10 MB。
app.use(express.json({ limit: '10mb' }));

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true';

const clerkAuth = isLocal
	? null
	: ClerkBackendAuthenticationForAstro({
		secretKey: process.env.CLERK_SECRET_KEY!,
		allowList: process.env.TINA_PUBLIC_ALLOWED_EMAIL
			? [process.env.TINA_PUBLIC_ALLOWED_EMAIL]
			: undefined,
		orgId: process.env.TINA_PUBLIC_CLERK_ORG_ID,
	});

const authProvider = isLocal
	? LocalBackendAuthProvider()
	: {
		isAuthorized: async (req: any) => {
			const result = await clerkAuth!.isAuthorized(req);
			// 如果用户认证成功，则读取用户 ID
			// 然后把用户信息保存进当前请求上下文
			// 这里根据用户是否拥有草稿工作区，选择数据命名空间 有草稿：`draft:<userId>`
			if (result.isAuthorized) {
				const store = requestContext.getStore();
				const userId = req.session?.user?.id;
				if (store && userId) {
					store.userId = userId;
					store.namespace = (await hasDraft(userId)) ? `draft:${userId}` : 'main';
					try {
						const identity = await getGithubIdentity(userId);
						store.login = identity.login;
						store.githubToken = identity.token;
					} catch (error) {
						store.githubError =
							error instanceof GithubAuthError ? error.code : 'unknown';
						logger.warn('tina.github_identity.lookup_failed', {
							error,
							code: store.githubError,
						});
					}
				}
			}
			return result;
		},
	};

// 包装 Tina 数据库请求,重写了 request 方法
const guardedClient = {
	...databaseClient,
	request: async (args: any) => {
		const ctx = requestContext.getStore();
		// Tina prefixes browser mutations with a `#graphql` comment. Remove
		// GraphQL comments before checking the operation type, otherwise saves
		// bypass the draft/commit path and only update the data layer.
		const query = String(args.query ?? '').replace(/^\s*#.*$/gm, '').trim();
		const isMutation = /^mutation(?:\s|\{|\()/i.test(query);
		if (!ctx?.userId || !isMutation) {
			return databaseClient.request(args);
		}

		// 限制同一个用户的保存频率，防止重复点击、脚本请求或异常重试造成大量写入
		// 加锁
		// 准备工作区、目标分支、GitHub 身份等写入信息。
		// 成功后提交 flushCommit
		try {
			await enforceRateLimit(ctx.userId, 'save:min');
			return await withLock(ctx.userId, async () => {
				const workspace = await prepareWrite(ctx);
				const result = await databaseClient.request(args);
				const errors = (result as { errors?: unknown[] | null }).errors;
				if (!errors || (Array.isArray(errors) && errors.length === 0)) {
					const commit = await flushCommit(ctx, workspace);
					logger.info('tina.save.completed', {
						bufferedOps: ctx.buffer?.length ?? 0,
						changedPaths: workspace.changedPaths?.length ?? 0,
						committed: commit.committed,
						...(commit.sha ? { sha: commit.sha } : {}),
					});
				} else {
					ctx.buffer = [];
					logger.warn('tina.save.graphql_failed', {
						errorCount: Array.isArray(errors) ? errors.length : 1,
					});
				}
				return result;
			});
		} catch (error) {
			// 清空暂存操作，并记录失败日志，不提交工作区
			logger.error('tina.save.failed', { error });
			const http = error instanceof HttpError ? error : null;
			return {
				data: null,
				query: args.query,
				variables: args.variables,
				errors: [
					{
						message: http?.message ?? 'Save failed',
						extensions: { code: http?.code ?? 'save_failed' },
					},
				],
			};
		}
	},
};

const tinaHandler = TinaNodeBackend({
	authProvider: authProvider as any,
	databaseClient: guardedClient as any,
});

app.use(createTinaApi({ isLocal, clerkAuth: clerkAuth as any }));

app.use((req, res, next) => {
	if (req.url.startsWith('/api/tina')) {
		const context = getRequestContext() ?? { requestId: requestIdFrom(req), buffer: [] };
		context.buffer = [];
		return requestContext.run(context, () => tinaHandler(req, res));
	}
	return next();
});

// Serve prerendered pages and Tina's static admin assets from the production build.
app.use(express.static(clientDir));

// Static hosting serves the public pages and admin assets. Astro only needs
// to handle the on-demand Tina island refresh endpoint on this server.
app.use((req, res, next) => {
	if (req.path.startsWith('/tina-island/')) {
		return astroHandler(req, res, next);
	}
	return next();
});

app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
	logger.error('http.request.unhandled_error', {
		error,
		method: req.method,
		path: req.path,
	});
	if (res.headersSent) return next(error);
	res.status(500).json({ error: 'internal_error', message: 'Unexpected server error' });
});

app.listen(port, () => {
	logger.info('server.started', { port, isLocal });
});

process.on('unhandledRejection', (error) => {
	logger.error('process.unhandled_rejection', { error });
});

process.on('uncaughtException', (error) => {
	logger.fatal('process.uncaught_exception', { error });
	process.exitCode = 1;
});

if (!isLocal) {
	startSweep();
}
