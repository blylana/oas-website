import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getOperationType } from '../tina/graphql-operation';

test('selects the sole operation independently of GraphQL formatting', () => {
	assert.equal(getOperationType('#graphql\nmutation Test { __typename }'), 'mutation');
	assert.equal(getOperationType('fragment TypeName on Mutation { __typename }\nmutation Test { ...TypeName }'), 'mutation');
	assert.equal(getOperationType('{ __typename }'), 'query');
});

test('fails closed for malformed, missing or ambiguous operations', () => {
	for (const document of [null, 'mutation {', 'query One { __typename } query Two { __typename }']) {
		assert.throws(() => getOperationType(document), { code: 'invalid_graphql' });
	}
});
