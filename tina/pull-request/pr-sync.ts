import { GithubApiError } from '../github/github';
import { getPull } from './github-api';
import { updateWorkspace, type Workspace } from '../workspace/workspace';
import { logger } from '../logger';

const owner = process.env.GITHUB_OWNER!;
const repo = process.env.GITHUB_REPO!;

export async function syncPrState(workspace: Workspace, token: string): Promise<Workspace> {
	if (!workspace.prNumber) return workspace;
	if (workspace.state === 'merged' || workspace.state === 'closed') return workspace;
	if (workspace.state !== 'submitted' && workspace.state !== 'editing') return workspace;

	let pull;
	try {
		pull = await getPull(token, owner, repo, workspace.prNumber);
	} catch (error) {
		if (error instanceof GithubApiError && error.status === 404) {
			return updateWorkspace(workspace._id, { state: 'closed', closedAt: new Date() });
		}
		throw error;
	}
	if (pull.merged_at) {
		logger.info('tina.pr.merged', { prNumber: workspace.prNumber });
		return updateWorkspace(workspace._id, {
			state: 'merged',
			mergedAt: new Date(pull.merged_at),
		});
	}
	if (pull.state === 'closed') {
		logger.info('tina.pr.closed', { prNumber: workspace.prNumber });
		return updateWorkspace(workspace._id, { state: 'closed', closedAt: new Date() });
	}
	return workspace;
}

export function getPullRequestStatus(workspace: Workspace | null, checkFailed: boolean) {
	if (!workspace?.prNumber) return { status: 'none' as const };
	const { state, endReason, purging, mergedAt, prNumber: number, prUrl: url } = workspace;
	let status: 'open' | 'merged' | 'closed' | 'unknown' | 'error' = 'open';
	if (state === 'merged' || mergedAt) status = 'merged';
	else if (endReason === 'closed' || (state === 'closed' && !purging)) status = 'closed';
	else if (checkFailed) status = 'error';
	else if (purging) status = 'unknown';
	return { status, number, url };
}
