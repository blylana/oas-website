import { appDb } from '../mongo';

type PublishedIndex = { _id: 'published'; namespace: string; sha: string };

function indexes() {
	return appDb().collection<PublishedIndex>('siteState');
}

export async function getPublishedIndex() {
	const current = await indexes().findOne({ _id: 'published' });
	return current ?? { namespace: 'main', sha: undefined };
}

export async function activatePublishedIndex(namespace: string, sha: string) {
	await indexes().updateOne({ _id: 'published' }, { $set: { namespace, sha } }, { upsert: true });
}
