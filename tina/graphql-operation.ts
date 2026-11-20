import { getOperationAST, parse } from 'graphql';
import { HttpError } from './http-error';

export function getOperationType(query: unknown) {
	if (typeof query !== 'string') {
		throw new HttpError(400, 'invalid_graphql', 'Expected a GraphQL document');
	}
	try {
		const operation = getOperationAST(parse(query));
		if (operation) return operation.operation;
	} catch {
		throw new HttpError(400, 'invalid_graphql', 'Invalid GraphQL document');
	}
	throw new HttpError(400, 'invalid_graphql', 'Send one GraphQL operation per request');
}
