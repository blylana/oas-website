import { createClient } from 'tinacms/dist/client';
import { queries } from '../../../tina/__generated__/types';

const siteOrigin =
	process.env.TINA_SITE_ORIGIN ||
	process.env.PUBLIC_SITE_URL ||
	`http://localhost:${process.env.PORT || 4321}`;

/**
 * The generated browser client intentionally uses a relative URL. Astro SSR
 * runs on Node, where fetch requires an absolute URL, so the preview uses this
 * server-side client instead.
 */
export const serverClient = createClient({
	url: `${siteOrigin.replace(/\/$/, '')}/api/tina/gql`,
	queries,
});

export function serverFetchOptions(request: Request) {
	const headers: Record<string, string> = {};
	for (const name of ['cookie', 'authorization', 'x-branch']) {
		const value = request.headers.get(name);
		if (value) headers[name] = value;
	}
	return { headers };
}
