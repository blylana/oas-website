import { closePull, deleteBranch, getRefSha, GithubApiError } from './github';
import { deleteDraft } from './tenant';
import { deleteWorkspace, updateWorkspace, type Workspace } from './workspace';
import { logger } from './logger';
import { invalidateEditRevision } from './edit-revision';

const owner = process.env.GITHUB_OWNER!;
const repo = process.env.GITHUB_REPO!;

export type PurgeResult = 'done' | 'pending';

/**
 * Discard a workspace: close the PR, delete the user branch, drop the draft and
 * the workspace document. If the branch cannot be deleted, keep the workspace
 * with `purging` set so the sweep retries later.
 */
export async function purgeWorkspace(workspace: Workspace, token: string): Promise<PurgeResult> {
	if (!workspace.purging) await updateWorkspace(workspace._id, { purging: true });
	await invalidateEditRevision(workspace._id);
	let pending = false;
	if (workspace.prNumber) {
		try {
			await closePull(token, owner, repo, workspace.prNumber);
		} catch (error) {
			if (!(error instanceof GithubApiError && error.status === 404)) {
				pending = true;
				logger.warn('tina.workspace.close_pr_failed', { error, prNumber: workspace.prNumber });
			}
		}
	}

	try {
		const head = await getRefSha(token, workspace.login, repo, workspace.branch);
		if (head !== null && head === workspace.headSha && workspace.login.toLowerCase() !== owner.toLowerCase()
			&& workspace.branch.startsWith('oas-draft-')) {
			await deleteBranch(token, workspace.login, repo, workspace.branch);
		} else if (head !== null) {
			logger.warn('tina.workspace.unowned_branch_preserved', { branch: workspace.branch });
		}
	} catch (error) {
		pending = true;
		logger.warn('tina.workspace.delete_branch_failed', { error, branch: workspace.branch });
	}

	await deleteDraft(workspace._id);

	if (pending) {
		await updateWorkspace(workspace._id, { purging: true, state: 'closed', closedAt: new Date() });
		return 'pending';
	}

	await deleteWorkspace(workspace._id);
	logger.info('tina.workspace.purged', {
		prNumber: workspace.prNumber,
		branch: workspace.branch,
	});
	return 'done';
}
