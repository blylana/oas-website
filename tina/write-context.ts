import { getRefSha } from './github';
import { HttpError } from './http-error';
import type { RequestContext } from './context';
import { cloneDraft, deleteDraft } from './tenant';
import { clearGithubIdentity } from './github-identity';
import { syncPrState } from './pr-sync';
import { createWorkspace, deleteWorkspace, getWorkspace, touchWorkspace, updateWorkspace, INACTIVE_MS, type Workspace } from './workspace';
import { purgeWorkspace } from './purge';
import { logger } from './logger';

const owner = process.env.GITHUB_OWNER!;
const repo = process.env.GITHUB_REPO!;
const baseBranch = process.env.GITHUB_BRANCH || 'tina';

async function newWorkspace(ctx: RequestContext): Promise<Workspace> {
	let baseSha: string | undefined;
	try {
		baseSha = (await getRefSha(ctx.githubToken!, owner, repo, baseBranch)) ?? undefined;
	} catch (error) {
		// GitHub may be down; the save still writes the draft and the commit is
		// retried later once the base commit can be resolved.
		logger.warn('github.base_branch_lookup_failed', { error, branch: baseBranch });
	}
	return createWorkspace({
		userId: ctx.userId!,
		login: ctx.login!,
		fork: `${ctx.login}/${repo}`,
		branch: ctx.login!,
		baseBranch,
		baseSha,
	});
}

export async function prepareWrite(ctx: RequestContext): Promise<Workspace> {
	if (!ctx.userId) {
		throw new HttpError(401, 'unauthorized', 'Missing Clerk user');
	}
	if (!ctx.login || !ctx.githubToken) {
		throw new HttpError(401, 'github_reauth', 'GitHub access is missing or expired; re-authorize');
	}

	let workspace = await getWorkspace(ctx.userId);

	if (workspace && workspace.login !== ctx.login) {
		clearGithubIdentity(ctx.userId);
		// The old branch lives in another account's fork and cannot be deleted
		// with the new token. Try once, then drop the local state regardless.
		try {
			await purgeWorkspace(workspace, ctx.githubToken);
		} catch (error) {
			logger.error('tina.workspace.login_change_cleanup_failed', { error });
		}
		await deleteWorkspace(ctx.userId);
		await deleteDraft(ctx.userId);
		workspace = null;
	}

	// A closed or merged PR means "discard everything"; do that before this save
	// writes anything new, as required for the next request after the close.
	if (workspace?.prNumber) {
		try {
			workspace = await syncPrState(workspace, ctx.githubToken);
		} catch (error) {
			// A transient GitHub failure must not lose the save; the sweep will
			// detect the final PR state later.
			logger.warn('tina.pr.save_time_sync_failed', { error });
		}
	}

	if (
		workspace &&
		(workspace.purging || workspace.state === 'merged' || workspace.state === 'closed')
	) {
		const purged = await purgeWorkspace(workspace, ctx.githubToken);
		if (purged === 'pending') {
			throw new HttpError(409, 'purging', 'The previous workspace is still being cleaned up');
		}
		workspace = null;
	}

	if (!workspace) {
		workspace = await newWorkspace(ctx);
	}

	// Expire idle drafts lazily even if the periodic sweep has not run yet.
	if (!workspace.prNumber && Date.now() - workspace.updatedAt.getTime() > INACTIVE_MS) {
		const purged = await purgeWorkspace(workspace, ctx.githubToken);
		if (purged === 'pending') {
			throw new HttpError(409, 'purging', 'The expired workspace is still being cleaned up');
		}
		workspace = await newWorkspace(ctx);
	}

	await cloneDraft(ctx.userId);
	ctx.namespace = `draft:${ctx.userId}`;
	if (workspace.pendingOps?.length) {
		// Retry commits that failed on the previous save, then apply this save on top.
		ctx.buffer = [...workspace.pendingOps];
	}

	// Keep `submitted` when a PR is already open: later saves update the same PR
	// and must still be checked for merge/close by the sweep.
	if (!workspace.prNumber) {
		await updateWorkspace(ctx.userId, { state: 'editing' });
	}
	await touchWorkspace(ctx.userId);
	return workspace;
}
