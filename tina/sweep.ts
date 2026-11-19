import { commitOps } from './commit';
import { getGithubIdentity } from './github-identity';
import { withLock } from './lock';
import { purgeWorkspace } from './purge';
import { syncPrState } from './pr-sync';
import { findWorkspaces, INACTIVE_MS } from './workspace';
import { logger } from './logger';

const SWEEP_MS = 10 * 60 * 1000;

let running = false;

async function tokenFor(userId: string) {
	try {
		return (await getGithubIdentity(userId)).token;
	} catch (error) {
		logger.warn('sweep.github_token_unavailable', { error, userId });
		return null;
	}
}

export async function runSweep(now = new Date()): Promise<void> {
	if (running) return;
	running = true;

	try {
		logger.info('sweep.started', { at: now.toISOString() });
		const workspaces = await findWorkspaces(
			{
				$or: [
					{ purging: true },
					{ pendingCommit: true },
					{ state: { $in: ['merged', 'closed'] } },
					{ state: 'submitted' },
					{ updatedAt: { $lt: new Date(now.getTime() - INACTIVE_MS) } },
				],
			},
			100,
		);

		for (const workspace of workspaces) {
			try {
				await withLock(workspace._id, async () => {
					const token = await tokenFor(workspace._id);
					if (workspace.purging || workspace.state === 'merged' || workspace.state === 'closed') {
						if (token) await purgeWorkspace(workspace, token);
						return;
					}

					if (workspace.pendingCommit && token && workspace.login) {
						await commitOps(workspace.pendingOps ?? [], workspace, {
							userId: workspace._id,
							login: workspace.login,
							token,
						});
						return;
					}

					if (workspace.state === 'submitted' && workspace.prNumber && token) {
						const synced = await syncPrState(workspace, token);
						if (synced.state === 'merged' || synced.state === 'closed') {
							await purgeWorkspace(synced, token);
						}
						return;
					}

					if (workspace.prNumber && token) {
						const synced = await syncPrState(workspace, token);
						if (synced.state === 'merged' || synced.state === 'closed') {
							await purgeWorkspace(synced, token);
						}
						return;
					}

					// Inactive for 7 days and no open PR: discard the draft and branch.
					if (token) await purgeWorkspace(workspace, token);
				});
			} catch (error) {
				logger.error('sweep.workspace_failed', { error, workspaceId: workspace._id });
			}
		}
		logger.info('sweep.completed', { workspaceCount: workspaces.length });
	} finally {
		running = false;
	}
}

export function startSweep() {
	const run = () => void runSweep().catch((error) => logger.error('sweep.failed', { error }));
	const interval = setInterval(run, SWEEP_MS);
	interval.unref?.();
	const first = setTimeout(run, 30_000);
	first.unref?.();
}
