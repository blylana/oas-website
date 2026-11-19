import { logger } from './logger';

const API = 'https://api.github.com';

export class GithubApiError extends Error {
	status: number;
	details: unknown;

	constructor(status: number, message: string, details?: unknown) {
		super(message);
		this.name = 'GithubApiError';
		this.status = status;
		this.details = details;
	}
}

async function call<T>(
	token: string,
	method: string,
	path: string,
	body?: unknown,
): Promise<T> {
	const startedAt = performance.now();
	let response: Response;
	try {
		response = await fetch(`${API}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github+json',
				'User-Agent': 'oas-website',
				'X-GitHub-Api-Version': '2022-11-28',
				...(body ? { 'Content-Type': 'application/json' } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(20_000),
		});
	} catch (error) {
		logger.error('github.request.transport_failed', {
			method,
			path,
			durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
			error,
		});
		throw error;
	}

	if (!response.ok) {
		const text = await response.text();
		const error = new GithubApiError(
			response.status,
			`GitHub ${method} ${path} failed with status ${response.status}`,
			text,
		);
		logger.warn('github.request.failed', {
			method,
			path,
			status: response.status,
			durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
			error,
		});
		throw error;
	}

	logger.info('github.request.completed', {
		method,
		path,
		status: response.status,
		durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
	});
	if (response.status === 204) return undefined as T;
	return (await response.json()) as T;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type GithubRepo = {
	full_name: string;
	fork: boolean;
	default_branch?: string;
	parent?: { full_name: string };
};

export async function getRepo(token: string, owner: string, repo: string) {
	try {
		return await call<GithubRepo>(token, 'GET', `/repos/${owner}/${repo}`);
	} catch (error) {
		if (error instanceof GithubApiError && error.status === 404) return null;
		throw error;
	}
}

const forkCache = new Set<string>();

export async function ensureFork(input: {
	token: string;
	owner: string;
	repo: string;
	login: string;
}): Promise<string> {
	const { token, owner, repo, login } = input;
	const fullName = `${login}/${repo}`;
	if (forkCache.has(fullName)) return fullName;

	const existing = await getRepo(token, login, repo);
	if (existing) {
		if (!existing.fork && existing.full_name !== `${owner}/${repo}`) {
			throw new GithubApiError(409, `${fullName} exists but is not a fork of ${owner}/${repo}`);
		}
		if (existing.fork && existing.parent?.full_name !== `${owner}/${repo}`) {
			throw new GithubApiError(409, `${fullName} is a fork of ${existing.parent?.full_name ?? 'another repo'}`);
		}
		forkCache.add(fullName);
		return fullName;
	}

	await call(token, 'POST', `/repos/${owner}/${repo}/forks`, {});
	for (let attempt = 0; attempt < 20; attempt++) {
		await sleep(1000);
		const created = await getRepo(token, login, repo);
		if (created) {
			forkCache.add(fullName);
			return fullName;
		}
	}
	throw new GithubApiError(504, `Fork ${fullName} was not ready in time`);
}

export async function getRefSha(
	token: string,
	owner: string,
	repo: string,
	branch: string,
): Promise<string | null> {
	try {
		const ref = await call<{ object: { sha: string } }>(
			token,
			'GET',
			`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
		);
		return ref.object.sha;
	} catch (error) {
		if (error instanceof GithubApiError && error.status === 404) return null;
		throw error;
	}
}

export async function createRef(
	token: string,
	owner: string,
	repo: string,
	branch: string,
	sha: string,
) {
	await call(token, 'POST', `/repos/${owner}/${repo}/git/refs`, {
		ref: `refs/heads/${branch}`,
		sha,
	});
}

export async function syncForkDefaultBranch(input: {
	token: string;
	login: string;
	repo: string;
}) {
	const fork = await getRepo(input.token, input.login, input.repo);
	if (!fork?.default_branch) return;
	await mergeUpstream(input.token, input.login, input.repo, fork.default_branch);
}

export async function createOrFastForwardRef(input: {
	token: string;
	owner: string;
	repo: string;
	branch: string;
	sha: string;
	parentSha: string | null;
	onConflict?: () => Promise<void>;
}) {
	const { token, owner, repo, branch, sha, parentSha, onConflict } = input;
	if (!parentSha) {
		try {
			await createRef(token, owner, repo, branch, sha);
		} catch (error) {
			if (error instanceof GithubApiError && error.status === 422 && onConflict) {
				// A stale fork may not know the upstream commit yet.
				await onConflict();
				await createRef(token, owner, repo, branch, sha);
				return;
			}
			throw error;
		}
		return;
	}

	const update = async () =>
		call(token, 'PATCH', `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
			sha,
			force: false,
		});

	try {
		await update();
	} catch (error) {
		if (error instanceof GithubApiError && error.status === 422) {
			// The fork may be behind upstream and not know the parent commit yet.
			if (onConflict) await onConflict();
			await update();
			return;
		}
		throw error;
	}
}

export type TreeEntry = {
	path: string;
	mode: '100644';
	type: 'blob';
	content?: string;
	sha?: string | null;
};

export async function commitFiles(input: {
	token: string;
	owner: string;
	repo: string;
	login: string;
	branch: string;
	baseSha?: string;
	message: string;
	changes: { path: string; content?: string; delete?: boolean }[];
}): Promise<{ sha: string; changedPaths: string[] }> {
	const { token, owner, repo, login, branch, baseSha, message, changes } = input;

	await ensureFork({ token, owner, repo, login });

	const parentSha = await getRefSha(token, login, repo, branch);
	if (!parentSha && !baseSha) {
		throw new GithubApiError(409, 'Branch does not exist and no base commit was recorded');
	}

	const parent = parentSha ?? baseSha!;
	let parentCommit: { tree: { sha: string } };
	try {
		parentCommit = await call<{ tree: { sha: string } }>(
			token,
			'GET',
			`/repos/${login}/${repo}/git/commits/${parent}`,
		);
	} catch (error) {
		if (error instanceof GithubApiError && error.status === 404 && !parentSha) {
			// A stale fork does not know the upstream head commit yet.
			await syncForkDefaultBranch({ token, login, repo });
			parentCommit = await call<{ tree: { sha: string } }>(
				token,
				'GET',
				`/repos/${login}/${repo}/git/commits/${parent}`,
			);
		} else {
			throw error;
		}
	}

	const tree: TreeEntry[] = changes.map((change) =>
		change.delete
			? { path: change.path, mode: '100644', type: 'blob', sha: null }
			: { path: change.path, mode: '100644', type: 'blob', content: change.content ?? '' },
	);

	const newTree = await call<{ sha: string }>(token, 'POST', `/repos/${login}/${repo}/git/trees`, {
		base_tree: parentCommit.tree.sha,
		tree,
	});

	const newCommit = await call<{ sha: string }>(token, 'POST', `/repos/${login}/${repo}/git/commits`, {
		message,
		tree: newTree.sha,
		parents: [parent],
	});

	await createOrFastForwardRef({
		token,
		owner: login,
		repo,
		branch,
		sha: newCommit.sha,
		parentSha,
		onConflict: () => syncForkDefaultBranch({ token, login, repo }),
	});

	return {
		sha: newCommit.sha,
		changedPaths: changes.map((change) => change.path),
	};
}

export type PullRequest = {
	number: number;
	html_url: string;
	state: 'open' | 'closed';
	merged_at: string | null;
	title: string;
	head: { ref: string };
};

export async function listOpenPulls(
	token: string,
	owner: string,
	repo: string,
	login: string,
	branch: string,
) {
	return call<PullRequest[]>(
		token,
		'GET',
		`/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${login}:${branch}`)}`,
	);
}

export async function createPull(input: {
	token: string;
	owner: string;
	repo: string;
	login: string;
	branch: string;
	base: string;
	title: string;
	body: string;
}) {
	const { token, owner, repo, login, branch, base, title, body } = input;
	return call<PullRequest>(token, 'POST', `/repos/${owner}/${repo}/pulls`, {
		title,
		body,
		head: `${login}:${branch}`,
		base,
	});
}

export async function getPull(token: string, owner: string, repo: string, number: number) {
	return call<PullRequest>(token, 'GET', `/repos/${owner}/${repo}/pulls/${number}`);
}

export async function closePull(token: string, owner: string, repo: string, number: number) {
	await call(token, 'PATCH', `/repos/${owner}/${repo}/pulls/${number}`, { state: 'closed' });
}

export async function deleteBranch(token: string, owner: string, repo: string, branch: string) {
	try {
		await call(token, 'DELETE', `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`);
	} catch (error) {
		if (error instanceof GithubApiError && (error.status === 404 || error.status === 422)) return;
		throw error;
	}
}

export async function mergeUpstream(token: string, login: string, repo: string, branch: string) {
	await call(token, 'POST', `/repos/${login}/${repo}/merge-upstream`, { branch });
}
