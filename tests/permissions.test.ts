import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EditorStatus } from '../tina/editor/status';
import { derivePermissions } from '../tina/permissions';

const newUser: EditorStatus = {
	auth: 'ready',
	content: { namespace: 'main', sha: undefined, published: 'ready', draft: 'absent' },
	workspace: { status: 'absent', tracked: false, hasChanges: false },
	github: { fork: 'unknown', branch: 'unconfirmed', commit: 'none' },
	pullRequest: { status: 'none' },
	stale: false,
};

test('disables all buttons before the first edit', () => {
	assert.deepEqual(derivePermissions(newUser, { dirty: false, valid: true, busy: false }), {
		reset: false, save: false, pr: false, clean: false,
	});
});

test('allows reset on invalid input and blocks simultaneous operations', () => {
	assert.deepEqual(derivePermissions(newUser, { dirty: true, valid: false, busy: false }), {
		reset: true, save: false, pr: false, clean: false,
	});
	assert.deepEqual(derivePermissions(newUser, { dirty: true, valid: true, busy: true }), {
		reset: false, save: false, pr: false, clean: false,
	});
});

test('lets Pr retry a saved GitHub commit and blocks writes from a stale page', () => {
	const pending: EditorStatus = {
		...newUser,
		content: { ...newUser.content, draft: 'ready' },
		workspace: { status: 'editing', tracked: true, hasChanges: true, endReason: undefined },
		github: { ...newUser.github, commit: 'pending' },
	};
	const form = { dirty: false, valid: true, busy: false };
	assert.deepEqual(derivePermissions(pending, form), { reset: false, save: false, pr: true, clean: true });
	assert.deepEqual(derivePermissions({ ...pending, stale: true }, form), {
		reset: false, save: false, pr: false, clean: false,
	});
});

test('blocks writes when content status cannot be read', () => {
	const status: EditorStatus = {
		...newUser,
		content: { ...newUser.content, published: 'error', draft: 'error' },
		workspace: { status: 'editing', tracked: true, hasChanges: true, endReason: undefined },
	};
	assert.deepEqual(derivePermissions(status, { dirty: true, valid: true, busy: false }), {
		reset: true, save: false, pr: false, clean: false,
	});
});
