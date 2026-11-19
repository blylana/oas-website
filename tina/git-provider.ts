import { getRequestContext } from './context';

/**
 * Tina writes to git through `GitProvider.onPut/onDelete` during the GraphQL
 * mutation. We only buffer those writes; the request wrapper flushes them as a
 * single commit after the database write succeeded.
 */
export class BufferingGitProvider {
	async onPut(key: string, value: string) {
		const ctx = getRequestContext();
		if (!ctx) throw new Error('No request context for GitHub put');
		ctx.buffer ??= [];
		ctx.buffer.push({ op: 'put', path: key, content: value });
	}

	async onDelete(key: string) {
		const ctx = getRequestContext();
		if (!ctx) throw new Error('No request context for GitHub delete');
		ctx.buffer ??= [];
		ctx.buffer.push({ op: 'delete', path: key });
	}
}