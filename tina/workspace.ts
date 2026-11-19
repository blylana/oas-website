import { appDb } from './mongo';
import type { BufferedOp } from './context';

export type WorkspaceState = 'none' | 'editing' | 'submitted' | 'merged' | 'closed';

export type Workspace = {
	_id: string;
	login: string;
	fork: string;
	forkReady: boolean;
	branch: string;
	baseBranch: string;
	baseSha?: string;
	state: WorkspaceState;
	headSha?: string;
	changedPaths: string[];
	prNumber?: number;
	prUrl?: string;
	pendingCommit?: boolean;
	pendingOps?: BufferedOp[];
	purging?: boolean;
	createdAt: Date;
	updatedAt: Date;
	submittedAt?: Date;
	mergedAt?: Date;
	closedAt?: Date;
};

const COLLECTION = 'workspaces';
export const INACTIVE_MS = 7 * 24 * 60 * 60 * 1000;

let indexesReady: Promise<void> | null = null;

function collection() {
	return appDb().collection<Workspace>(COLLECTION);
}

function ensureIndexes() {
	indexesReady ??= (async () => {
		await collection().createIndex({ updatedAt: 1 });
		await collection().createIndex({ state: 1 });
		await collection().createIndex({ prNumber: 1 });
	})();
	return indexesReady;
}

export async function getWorkspace(userId: string): Promise<Workspace | null> {
	await ensureIndexes();
	return collection().findOne({ _id: userId });
}

export async function findWorkspaces(
	filter: Record<string, unknown>,
	limit = 100,
): Promise<Workspace[]> {
	await ensureIndexes();
	return collection().find(filter).limit(limit).toArray();
}

export async function requireWorkspace(userId: string): Promise<Workspace> {
	const workspace = await getWorkspace(userId);
	if (!workspace) {
		throw new Error(`Workspace not found for ${userId}`);
	}
	return workspace;
}

export async function createWorkspace(input: {
	userId: string;
	login: string;
	fork: string;
	branch: string;
	baseBranch: string;
	baseSha?: string;
	state?: WorkspaceState;
}): Promise<Workspace> {
	await ensureIndexes();
	const now = new Date();
	const workspace: Workspace = {
		_id: input.userId,
		login: input.login,
		fork: input.fork,
		forkReady: false,
		branch: input.branch,
		baseBranch: input.baseBranch,
		baseSha: input.baseSha,
		state: input.state ?? 'editing',
		changedPaths: [],
		createdAt: now,
		updatedAt: now,
	};
	await collection().updateOne({ _id: input.userId }, { $set: workspace }, { upsert: true });
	return workspace;
}

export async function updateWorkspace(
	userId: string,
	patch: Partial<Omit<Workspace, '_id' | 'createdAt'>>,
): Promise<Workspace> {
	await ensureIndexes();
	const now = new Date();
	const result = await collection().findOneAndUpdate(
		{ _id: userId },
		{ $set: { ...patch, updatedAt: now } },
		{ returnDocument: 'after' },
	);
	if (!result.value) {
		throw new Error(`Workspace not found for ${userId}`);
	}
	return result.value;
}

export async function touchWorkspace(userId: string) {
	await updateWorkspace(userId, {});
}

export async function addChangedPaths(userId: string, paths: BufferedOp[]) {
	const workspace = await requireWorkspace(userId);
	const next = new Set(workspace.changedPaths);
	for (const entry of paths) {
		next.add(entry.path);
	}
	await updateWorkspace(userId, { changedPaths: [...next] });
}

export async function deleteWorkspace(userId: string) {
	await ensureIndexes();
	await collection().deleteOne({ _id: userId });
}