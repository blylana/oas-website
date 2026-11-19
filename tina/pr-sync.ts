import { getPull, GithubApiError } from './github';
import { updateWorkspace, type Workspace } from './workspace';
import { logger } from './logger';

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
