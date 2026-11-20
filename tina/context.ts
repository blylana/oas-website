import { AsyncLocalStorage } from 'node:async_hooks';

export type BufferedOp = {
	op: 'put' | 'delete';
	path: string;
	content?: string;
};

export type RequestContext = {
	requestId?: string;
	userId?: string;
	login?: string;
	githubToken?: string;
	githubError?: string;
	namespace?: string;
	editRevision?: string;
	setEditRevision?: (revision: string) => void;
	markSaveReceived?: () => void;
	buffer?: BufferedOp[];
};

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
	return requestContext.getStore();
}
