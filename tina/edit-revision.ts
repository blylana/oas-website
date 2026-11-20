import { randomUUID } from 'node:crypto';
import { appDb } from './mongo';
import { HttpError } from './http-error';
import { getPublishedIndex } from './published-index';

export const EDIT_REVISION_HEADER = 'x-oas-edit-revision';

function revisions() {
	return appDb().collection<{ _id: string; revision: string }>('editRevisions');
}

export async function getEditRevision(userId: string, namespace?: string) {
	const published = namespace ?? (await getPublishedIndex()).namespace;
	const generation = (await revisions().findOne({ _id: userId }))?.revision ?? 'initial';
	return `${published}/${generation}`;
}

export async function invalidateEditRevision(userId: string) {
	await revisions().updateOne({ _id: userId }, { $set: { revision: randomUUID() } }, { upsert: true });
}

export function staleEditor() {
	return new HttpError(409, 'stale_editor', '草稿已结束或被清理，请刷新编辑器后重新编辑。');
}

export async function assertEditRevision(userId: string, revision: string | undefined, namespace?: string) {
	if (revision !== await getEditRevision(userId, namespace)) throw staleEditor();
}
