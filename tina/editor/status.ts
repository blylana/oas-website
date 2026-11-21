import { getAuthStatus } from '../auth/github-identity';
import { getContentStatus } from '../content/status';
import { getGithubStatus } from '../github/commit';
import { getPullRequestStatus } from '../pull-request/pr-sync';
import { getWorkspaceStatus, type Workspace } from '../workspace/workspace';
import { getEditRevision } from './edit-revision';

export async function getEditorStatus(
	identity: { userId: string; login?: string; githubError?: string },
	workspace: Workspace | null,
	editRevision: string | undefined,
	prCheckFailed: boolean,
) {
	const content = await getContentStatus(identity.userId);
	let revision: string | undefined;
	try {
		revision = await getEditRevision(identity.userId, content.namespace);
	} catch {
		// The status endpoint still returns the other known facts when the
		// revision collection is temporarily unavailable.
	}
	return {
		auth: getAuthStatus(identity.githubError, Boolean(workspace && identity.login && workspace.login !== identity.login)),
		content,
		workspace: getWorkspaceStatus(workspace),
		github: getGithubStatus(workspace),
		pullRequest: getPullRequestStatus(workspace, prCheckFailed),
		stale: Boolean(editRevision && editRevision !== revision),
	};
}

export type EditorStatus = Awaited<ReturnType<typeof getEditorStatus>>;
