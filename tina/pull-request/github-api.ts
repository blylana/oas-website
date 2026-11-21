import { call } from '../github/github';

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
