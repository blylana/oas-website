import type { EditorStatus } from '../editor/status';

export type FormFacts = {
	dirty: boolean;
	valid: boolean;
	busy: boolean;
};

export function derivePermissions(status: EditorStatus | null, { dirty, valid, busy }: FormFacts) {
	const workspace = status?.workspace;
	const cleaning = workspace?.status === 'cleaning' || workspace?.status === 'cleanup_pending';
	const contentUnavailable = status?.content.published === 'error' || status?.content.draft === 'error';
	const canWrite = !busy && !status?.stale && !cleaning && !contentUnavailable;
	const canCommit = canWrite && status?.auth === 'ready';
	const hasReviewChanges = workspace?.hasChanges || status?.pullRequest.status === 'open';
	return {
		reset: dirty && !busy,
		save: canCommit && dirty && valid,
		pr: canCommit && (dirty ? valid : Boolean(hasReviewChanges)),
		clean: canWrite && status !== null && status.auth !== 'login_changed' &&
			(workspace?.tracked === true || status.content.draft === 'ready'),
	};
}
