import { closePull, deleteBranch } from './github';
import { deleteDraft } from './tenant';
import { deleteWorkspace, updateWorkspace, type Workspace } from './workspace';
import { logger } from './logger';

const owner = process.env.GITHUB_OWNER!;
const repo = process.env.GITHUB_REPO!;

export type PurgeResult = 'done' | 'pending';

/**
 * Discard a workspace: close the PR, delete the user branch, drop the draft and
 * the workspace document. If the branch cannot be deleted, keep the workspace
 * with `purging` set so the sweep retries later.
 */
export async function purgeWorkspace(workspace: Workspace, token: string): Promise<PurgeResult> {
	if (workspace.prNumber) {
		try {
			await closePull(token, owner, repo, workspace.prNumber);
		} catch (error) {
			// A missing PR is fine; anything else is retried by the sweep.
			logger.warn('tina.workspace.close_pr_failed', { error, prNumber: workspace.prNumber });
		}
	}

	let branchDeleted = true;
	try {
		await deleteBranch(token, workspace.login, repo, workspace.branch);
	} catch (error) {
		branchDeleted = false;
		logger.warn('tina.workspace.delete_branch_failed', { error, branch: workspace.branch });
	}

	await deleteDraft(workspace._id);

	if (!branchDeleted) {
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
