import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

const prefix = `test-backend-${randomUUID()}`;
const userId = `${prefix}-user`;
const login = `${prefix}-login`;
const branch = `oas-draft-${randomUUID()}`;
const owner = `${prefix}-owner`;
const repo = `${prefix}-repo`;

process.env.MONGODB_URI = process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017';
process.env.TINA_PUBLIC_IS_LOCAL = 'false';
process.env.GITHUB_OWNER = owner;
process.env.GITHUB_REPO = repo;
process.env.GITHUB_BRANCH = 'tina';

type RequestRecord = {
	method: string;
	path: string;
	body?: Record<string, unknown>;
};

type MockState = {
	requests: RequestRecord[];
	mode: 'commit' | 'pending' | 'pr-merged' | 'pr-closed' | 'pr-404' | 'purge' | 'purge-pending' | 'close-pending';
	sha: number;
	head?: string;
};

function jsonResponse(status: number, value: unknown) {
	return new Response(JSON.stringify(value), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function emptyResponse(status = 204) {
	return new Response(null, { status });
}

function createGithubMock(state: MockState) {
	return async (input: string | URL, init?: RequestInit) => {
		const url = String(input);
		const parsed = new URL(url);
		assert.equal(parsed.origin, 'https://api.github.com');
		const path = parsed.pathname + parsed.search;
		const method = init?.method ?? 'GET';
		let body: Record<string, unknown> | undefined;
		if (init?.body) body = JSON.parse(String(init.body)) as Record<string, unknown>;
		state.requests.push({ method, path, body });

		if (method === 'GET' && path === `/repos/${login}/${repo}`) {
			return jsonResponse(200, {
				full_name: `${login}/${repo}`,
				fork: true,
				default_branch: 'main',
				parent: { full_name: `${owner}/${repo}` },
			});
		}
		if (method === 'GET' && path === `/repos/${owner}/${repo}/git/ref/heads/tina`) {
			return jsonResponse(200, { object: { sha: 'upstream-base' } });
		}
		if (method === 'GET' && path === `/repos/${login}/${repo}/git/ref/heads/${branch}`) {
			return state.head
				? jsonResponse(200, { object: { sha: state.head } })
				: jsonResponse(404, { message: 'missing branch' });
		}
		if (method === 'GET' && path.startsWith(`/repos/${login}/${repo}/git/commits/`)) {
			return jsonResponse(200, { tree: { sha: 'base-tree' } });
		}
		if (method === 'POST' && path === `/repos/${login}/${repo}/git/trees`) {
			if (state.mode === 'pending') return jsonResponse(500, { message: 'mock tree failure' });
			return jsonResponse(201, { sha: `tree-${++state.sha}` });
		}
		if (method === 'POST' && path === `/repos/${login}/${repo}/git/commits`) {
			return jsonResponse(201, { sha: `commit-${++state.sha}` });
		}
		if (method === 'POST' && path === `/repos/${login}/${repo}/git/refs`) {
			state.head = String(body?.sha);
			return jsonResponse(201, {});
		}
		if (method === 'PATCH' && path === `/repos/${login}/${repo}/git/refs/heads/${branch}`) {
			state.head = String(body?.sha);
			return jsonResponse(200, {});
		}
		if (method === 'GET' && path === `/repos/${owner}/${repo}/pulls/123`) {
			if (state.mode === 'pr-404') return jsonResponse(404, { message: 'missing pull' });
			if (state.mode === 'pr-merged') {
				return jsonResponse(200, {
					number: 123,
					html_url: 'https://github.test/pull/123',
					state: 'closed',
					merged_at: '2026-11-20T00:00:00.000Z',
					title: 'mock',
					head: { ref: login },
				});
			}
			return jsonResponse(200, {
				number: 123,
				html_url: 'https://github.test/pull/123',
				state: state.mode === 'pr-closed' ? 'closed' : 'open',
				merged_at: null,
				title: 'mock',
				head: { ref: login },
			});
		}
		if (method === 'PATCH' && path === `/repos/${owner}/${repo}/pulls/123`) {
			if (state.mode === 'close-pending') return jsonResponse(503, { message: 'mock PR close failure' });
			return jsonResponse(200, {});
		}
		if (method === 'DELETE' && path === `/repos/${login}/${repo}/git/refs/heads/${branch}`) {
			if (state.mode === 'purge-pending') return jsonResponse(422, { message: 'mock delete refused' });
			state.head = undefined;
			return emptyResponse(204);
		}
		return jsonResponse(404, { message: `unhandled mock route ${method} ${path}` });
	};
}

const originalFetch = globalThis.fetch;
let db: ReturnType<(typeof import('../tina/mongo'))['appDb']>;
let getWorkspace: typeof import('../tina/workspace')['getWorkspace'];
let createWorkspace: typeof import('../tina/workspace')['createWorkspace'];
let updateWorkspace: typeof import('../tina/workspace')['updateWorkspace'];
let acquireLock: typeof import('../tina/lock')['acquireLock'];
let releaseLock: typeof import('../tina/lock')['releaseLock'];
let enforceRateLimit: typeof import('../tina/ratelimit')['enforceRateLimit'];
let commitOps: typeof import('../tina/commit')['commitOps'];
let syncPrState: typeof import('../tina/pr-sync')['syncPrState'];
let purgeWorkspace: typeof import('../tina/purge')['purgeWorkspace'];
let appDb: typeof import('../tina/mongo')['appDb'];
let getMongo: typeof import('../tina/mongo')['getMongo'];
let contentPrefix: typeof import('../tina/tenant')['contentPrefix'];

before(async () => {
	({ appDb, getMongo } = await import('../tina/mongo'));
	({ getWorkspace, createWorkspace, updateWorkspace } = await import('../tina/workspace'));
	({ acquireLock, releaseLock } = await import('../tina/lock'));
	({ enforceRateLimit } = await import('../tina/ratelimit'));
	({ commitOps } = await import('../tina/commit'));
	({ syncPrState } = await import('../tina/pr-sync'));
	({ purgeWorkspace } = await import('../tina/purge'));
	({ contentPrefix } = await import('../tina/tenant'));
	db = appDb();
});

after(async () => {
	globalThis.fetch = originalFetch;
	if (!db) return;
	try {
		const idFilter = { _id: { $regex: `^${prefix}-` } };
		const results = await Promise.allSettled([
			db.collection<{ _id: string }>('workspaces').deleteMany(idFilter),
			db.collection<{ _id: string }>('locks').deleteMany(idFilter),
			db.collection<{ _id: string }>('ratelimits').deleteMany(idFilter),
			db.collection<{ _id: string }>('editRevisions').deleteMany(idFilter),
			db.collection('tinacms').deleteMany({ key: { $regex: `^${contentPrefix('draft:').slice(0, -1)}${prefix}-` } }),
		]);
		for (const result of results) {
			if (result.status === 'rejected') throw result.reason;
		}
	} finally {
		await getMongo().close();
	}
});

function createFixture(id: string, overrides: Partial<Parameters<typeof createWorkspace>[0]> = {}) {
	return createWorkspace({
		userId: id,
		login,
		fork: `${login}/${repo}`,
		branch,
		baseBranch: 'tina',
		...overrides,
	});
}

describe('backend persistence and GitHub mapping', () => {
	it('maps a unique user id to one workspace and updates it', async () => {
		const workspace = await createFixture(userId);
		assert.equal(workspace._id, userId);
		assert.equal((await getWorkspace(userId))?.fork, `${login}/${repo}`);
		assert.equal(await getWorkspace(`${userId}-other`), null);
		const updated = await updateWorkspace(userId, { changedPaths: ['docs/a.mdx'], state: 'editing' });
		assert.deepEqual(updated.changedPaths, ['docs/a.mdx']);
		assert.equal(updated.state, 'editing');
	});

	it('serializes locks and releases them', async () => {
		const lockUser = `${prefix}-lock`;
		const owner = await acquireLock(lockUser);
		try {
			await assert.rejects(acquireLock(lockUser), (error: unknown) => {
				return (error as { status?: number; code?: string }).status === 409 && (error as { code?: string }).code === 'workspace_busy';
			});
		} finally {
			await releaseLock(lockUser, owner);
		}
		const secondOwner = await acquireLock(lockUser);
		await releaseLock(lockUser, secondOwner);
	});

	it('enforces the 30-per-minute save and 5-per-day PR limits for sequential calls', async () => {
		for (const [bucket, limit] of [['save:min', 30], ['pr:day', 5]] as const) {
			const rateUser = `${prefix}-rate`;
			for (let count = 1; count <= limit; count++) assert.equal(await enforceRateLimit(rateUser, bucket), count);
			await assert.rejects(enforceRateLimit(rateUser, bucket), { status: 429, code: 'rate_limited' });
		}
	});

	it('deduplicates puts, emits delete tree entries, creates a commit and updates the ref', async () => {
		const state: MockState = { requests: [], mode: 'commit', sha: 0 };
		globalThis.fetch = createGithubMock(state) as typeof fetch;
		const commitUser = `${userId}-commit`;
		const workspace = await createFixture(commitUser);
		const result = await commitOps(
			[
				{ op: 'put', path: 'docs/a.mdx', content: 'old' },
				{ op: 'put', path: 'docs/a.mdx', content: 'new' },
				{ op: 'delete', path: 'docs/b.mdx' },
			],
			workspace,
			{ userId: commitUser, login, token: 'mock-token' },
		);
		assert.equal(result.committed, true);
		assert.equal(result.sha, 'commit-2');
		const tree = state.requests.find((request) => request.path.endsWith('/git/trees'))?.body?.tree as Array<Record<string, unknown>>;
		assert.deepEqual(tree, [
			{ path: 'docs/a.mdx', mode: '100644', type: 'blob', content: 'new' },
			{ path: 'docs/b.mdx', mode: '100644', type: 'blob', sha: null },
		]);
		assert.deepEqual(state.requests.find((request) => request.path.endsWith('/git/refs'))?.body, {
			ref: `refs/heads/${branch}`,
			sha: 'commit-2',
		});
		const saved = await getWorkspace(commitUser);
		assert.ok(saved);
		assert.equal(saved?.pendingCommit, false);
		assert.equal(saved?.headSha, 'commit-2');
		assert.equal(saved.baseSha, 'upstream-base');
		assert.deepEqual(saved?.changedPaths, ['docs/a.mdx', 'docs/b.mdx']);

		const next = await commitOps([{ op: 'put', path: 'docs/c.mdx', content: 'second save' }], saved, {
			userId: commitUser, login, token: 'mock-token',
		});
		assert.equal(next.sha, 'commit-4');
		assert.deepEqual(state.requests.find((request) => request.method === 'PATCH')?.body, {
			sha: 'commit-4', force: false,
		});
		assert.deepEqual(state.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/git/commits')).at(-1)?.body?.parents, ['commit-2']);
	});

	it('records pending operations when GitHub commit creation fails', async () => {
		const pendingUser = `${userId}-pending`;
		const workspace = await createFixture(pendingUser, { baseSha: 'base-sha' });
		const state: MockState = { requests: [], mode: 'pending', sha: 0 };
		globalThis.fetch = createGithubMock(state) as typeof fetch;
		const identity = { userId: pendingUser, login, token: 'mock-token' };
		const result = await commitOps([{ op: 'put', path: 'docs/pending.mdx', content: 'retry' }], workspace, identity);
		assert.equal(result.committed, false);
		const saved = await getWorkspace(pendingUser);
		assert.equal(saved?.pendingCommit, true);
		assert.deepEqual(saved?.pendingOps, [{ op: 'put', path: 'docs/pending.mdx', content: 'retry' }]);
		assert.equal(saved.headSha, undefined);
		state.mode = 'commit';
		assert.equal((await commitOps(saved.pendingOps!, saved, identity)).committed, true);
		const retried = await getWorkspace(pendingUser);
		assert.equal(retried?.pendingCommit, false);
		assert.deepEqual(retried?.pendingOps, []);
	});

	it('maps merged, closed and missing PR states', async () => {
		for (const [suffix, mode, expected] of [
			['pr', 'pr-merged', 'merged'],
			['closed', 'pr-closed', 'closed'],
			['404', 'pr-404', 'closed'],
		] as const) {
			const id = `${userId}-${suffix}`;
			await createFixture(id, { state: 'submitted' });
			const submitted = await updateWorkspace(id, { prNumber: 123 });
			const state: MockState = { requests: [], mode, sha: 0 };
			globalThis.fetch = createGithubMock(state) as typeof fetch;
			const result = await syncPrState(submitted, 'mock-token');
			assert.equal(result.state, expected);
			assert.equal((await getWorkspace(id))?.state, expected);
		}
	});

	it('purges the PR, branch and workspace, and preserves a pending purge on branch failure', async () => {
		const purgeId = `${userId}-purge`;
		await createFixture(purgeId, { state: 'submitted' });
		const submitted = await updateWorkspace(purgeId, { prNumber: 123, headSha: 'managed-head' });
		const drafts = db.collection('tinacms');
		const draftKey = `${contentPrefix(`draft:${purgeId}`)}fixture.mdx`;
		await drafts.insertOne({ key: draftKey, value: { title: 'fixture' } });
		let state: MockState = { requests: [], mode: 'purge', sha: 0, head: 'managed-head' };
		globalThis.fetch = createGithubMock(state) as typeof fetch;
		const done = await purgeWorkspace(submitted, 'mock-token');
		assert.equal(done, 'done');
		assert.equal(await getWorkspace(purgeId), null);
		assert.equal(await drafts.findOne({ key: draftKey }), null);
		assert.deepEqual(state.requests.map(({ method, path }) => [method, path]), [
			['PATCH', `/repos/${owner}/${repo}/pulls/123`],
			['GET', `/repos/${login}/${repo}/git/ref/heads/${branch}`],
			['DELETE', `/repos/${login}/${repo}/git/refs/heads/${branch}`],
		]);

		const pendingId = `${userId}-pending-purge`;
		await createFixture(pendingId, { state: 'submitted' });
		const workspace = await updateWorkspace(pendingId, { headSha: 'managed-head' });
		state = { requests: [], mode: 'purge-pending', sha: 0, head: 'managed-head' };
		globalThis.fetch = createGithubMock(state) as typeof fetch;
		const pending = await purgeWorkspace(workspace, 'mock-token');
		assert.equal(pending, 'pending');
		const saved = await getWorkspace(pendingId);
		assert.equal(saved?.purging, true);
		assert.equal(saved?.state, 'closed');
		state.mode = 'purge';
		assert.equal(await purgeWorkspace(saved!, 'mock-token'), 'done');
		assert.equal(await getWorkspace(pendingId), null);
	});

	it('preserves a branch edited outside Tina and invalidates old editors', async () => {
		const { assertEditRevision, getEditRevision } = await import('../tina/edit-revision');
		const id = `${userId}-foreign-ref`;
		await createFixture(id);
		const revision = await getEditRevision(id);
		await assertEditRevision(id, revision);
		const workspace = await updateWorkspace(id, { headSha: 'recorded-head', baseSha: 'base-sha' });
		const state: MockState = { requests: [], mode: 'commit', sha: 0, head: 'outside-edit' };
		globalThis.fetch = createGithubMock(state) as typeof fetch;
		const result = await commitOps([{ op: 'put', path: 'docs/a.mdx', content: 'edit' }], workspace, {
			userId: id, login, token: 'mock-token',
		});
		assert.equal(result.committed, false);
		assert.equal(await purgeWorkspace(workspace, 'mock-token'), 'done');
		assert.ok(state.requests.every(({ method }) => method === 'GET'));
		assert.equal(state.head, 'outside-edit');
		await assert.rejects(assertEditRevision(id, revision), { code: 'stale_editor' });
	});

	it('retains PR metadata when closing the PR fails after confirming the branch is absent', async () => {
		const id = `${userId}-close-pending`;
		await createFixture(id, { state: 'submitted' });
		const submitted = await updateWorkspace(id, { prNumber: 123 });
		const state: MockState = { requests: [], mode: 'close-pending', sha: 0 };
		globalThis.fetch = createGithubMock(state) as typeof fetch;
		assert.equal(await purgeWorkspace(submitted, 'mock-token'), 'pending');
		const saved = await getWorkspace(id);
		assert.equal(saved?.prNumber, 123);
		assert.equal(saved?.purging, true);
		state.mode = 'purge';
		assert.equal(await purgeWorkspace(saved!, 'mock-token'), 'done');
		assert.equal(await getWorkspace(id), null);
	});

	it('rejects a save that discovers its PR has closed', async () => {
		const { prepareWrite } = await import('../tina/write-context');
		const id = `${userId}-closed-save`;
		await createFixture(id, { state: 'submitted' });
		await updateWorkspace(id, { prNumber: 123 });
		const state: MockState = { requests: [], mode: 'pr-closed', sha: 0 };
		globalThis.fetch = createGithubMock(state) as typeof fetch;
		await assert.rejects(prepareWrite({ userId: id, login, githubToken: 'mock-token' }), { code: 'stale_editor' });
		assert.equal(await getWorkspace(id), null);
		assert.ok(!state.requests.some(({ method }) => method === 'POST'));
	});

	it('rechecks an expired candidate after a save has renewed it', async () => {
		const { sweepWorkspace } = await import('../tina/sweep');
		const { INACTIVE_MS } = await import('../tina/workspace');
		const id = `${userId}-renewed`;
		const candidate = await createFixture(id);
		const now = new Date();
		await db.collection<{ _id: string }>('workspaces').updateOne(
			{ _id: id }, { $set: { updatedAt: new Date(now.getTime() - INACTIVE_MS - 1) } },
		);
		await updateWorkspace(id, { changedPaths: ['docs/renewed.mdx'] });
		await sweepWorkspace(candidate._id, now, async () => assert.fail('A renewed workspace should not call GitHub'));
		assert.deepEqual((await getWorkspace(id))?.changedPaths, ['docs/renewed.mdx']);
	});

	it('cleans up a closed PR before retrying any queued save', async () => {
		const { sweepWorkspace } = await import('../tina/sweep');
		const id = `${userId}-closed-pending`;
		await createFixture(id, { state: 'submitted' });
		await updateWorkspace(id, {
			prNumber: 123,
			pendingCommit: true,
			pendingOps: [{ op: 'put', path: 'docs/a.mdx', content: 'old' }],
		});
		const state: MockState = { requests: [], mode: 'pr-closed', sha: 0 };
		globalThis.fetch = createGithubMock(state) as typeof fetch;
		await sweepWorkspace(id, new Date(), async () => ({ login, token: 'mock-token', scopes: [] }));
		assert.equal(await getWorkspace(id), null);
		assert.ok(!state.requests.some(({ method }) => method === 'POST'));
	});
});
