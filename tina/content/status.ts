import { getPublishedIndex } from './published-index';
import { hasDraft, hasNamespace } from './tenant';

export type ContentStatus = {
	namespace: string;
	sha?: string;
	published: 'ready' | 'missing' | 'error';
	draft: 'ready' | 'absent' | 'error';
	error?: string;
};

export async function getContentStatus(userId: string): Promise<ContentStatus> {
	try {
		const { namespace, sha } = await getPublishedIndex();
		const [published, draft] = await Promise.all([hasNamespace(namespace), hasDraft(userId)]);
		return {
			namespace,
			sha,
			published: published ? 'ready' : 'missing',
			draft: draft ? 'ready' : 'absent',
		};
	} catch (error) {
		return {
			namespace: 'unknown',
			published: 'error',
			draft: 'error',
			error: error instanceof Error ? error.message : 'content_status_unavailable',
		};
	}
}
