import { Clerk } from '@clerk/backend';

let clerkClient: ReturnType<typeof Clerk> | undefined;

function getClerk() {
	if (!clerkClient) {
		if (!process.env.CLERK_SECRET_KEY) {
			throw new Error('CLERK_SECRET_KEY is required');
		}
		clerkClient = Clerk({ secretKey: process.env.CLERK_SECRET_KEY });
	}
	return clerkClient;
}

export type GithubIdentity = {
	login: string;
	token: string;
	scopes: string[];
};

export type GithubAuthErrorCode = 'no_token' | 'missing_scope' | 'unauthorized';

export class GithubAuthError extends Error {
	code: GithubAuthErrorCode;

	constructor(code: GithubAuthErrorCode, message: string) {
		super(message);
		this.name = 'GithubAuthError';
		this.code = code;
	}
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: GithubIdentity; expires: number }>();

export function clearGithubIdentity(userId: string) {
	cache.delete(userId);
}

export async function getGithubIdentity(userId: string, fresh = false): Promise<GithubIdentity> {
	const hit = cache.get(userId);
	if (!fresh && hit && hit.expires > Date.now()) {
		return hit.value;
	}

	let tokens;
	try {
		tokens = await getClerk().users.getUserOauthAccessToken(userId, 'oauth_github');
	} catch (error) {
		const code = (error as { errors?: { code?: string }[]; code?: string })?.errors?.[0]?.code ??
			(error as { code?: string })?.code;
		if (code === 'oauth_shared_credentials_token_retrieval_not_supported') {
			throw new GithubAuthError(
				'no_token',
				'Clerk is using shared GitHub credentials; configure custom OAuth credentials and re-authorize.',
			);
		}
		throw error;
	}

	const token = tokens?.[0]?.token;
	if (!token) {
		throw new GithubAuthError('no_token', 'No GitHub token for this user; re-authorize.');
	}

	const scopes = tokens[0].scopes ?? [];
	if (scopes.length > 0 && !scopes.includes('public_repo')) {
		throw new GithubAuthError('missing_scope', 'The GitHub token is missing the public_repo scope; re-authorize.');
	}

	const response = await fetch('https://api.github.com/user', {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'User-Agent': 'oas-website',
		},
		signal: AbortSignal.timeout(10_000),
	});

	if (response.status === 401) {
		cache.delete(userId);
		throw new GithubAuthError('unauthorized', 'GitHub rejected the token; re-authorize.');
	}
	if (!response.ok) {
		throw new Error(`GitHub /user failed with ${response.status}`);
	}

	const profile = (await response.json()) as { login: string };
	const value: GithubIdentity = { login: profile.login, token, scopes };
	cache.set(userId, { value, expires: Date.now() + TTL_MS });
	return value;
}