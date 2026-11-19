import { appDb } from './mongo';
import { HttpError } from './http-error';

export type RateLimitBucket = 'save:min' | 'pr:day';

type RateDoc = {
	_id: string;
	windowStart: Date;
	count: number;
	expireAt: Date;
};

const LIMITS: Record<RateLimitBucket, { limit: number; windowMs: number }> = {
	'save:min': { limit: 30, windowMs: 60 * 1000 },
	'pr:day': { limit: 5, windowMs: 24 * 60 * 60 * 1000 },
};

const COLLECTION = 'ratelimits';

let indexesReady: Promise<void> | null = null;

function collection() {
	return appDb().collection<RateDoc>(COLLECTION);
}

function ensureIndexes() {
	indexesReady ??= collection()
		.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 })
		.then(() => undefined);
	return indexesReady;
}

export async function enforceRateLimit(userId: string, bucket: RateLimitBucket): Promise<number> {
	await ensureIndexes();

	const { limit, windowMs } = LIMITS[bucket];
	const now = Date.now();
	const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
	const expireAt = new Date(windowStart.getTime() + windowMs);
	const id = `${userId}:${bucket}`;

	const incremented = await collection().findOneAndUpdate(
		{ _id: id, windowStart: { $gte: windowStart } },
		{ $inc: { count: 1 } },
		{ returnDocument: 'after' },
	);

	if (incremented.value) {
		if (incremented.value.count > limit) {
			throw new HttpError(429, 'rate_limited', `Too many requests for ${bucket}; limit is ${limit}`);
		}
		return incremented.value.count;
	}

	try {
		const started = await collection().findOneAndUpdate(
			{ _id: id },
			{ $set: { windowStart, count: 1, expireAt } },
			{ upsert: true, returnDocument: 'after' },
		);
		return started.value?.count ?? 1;
	} catch (error) {
		if ((error as { code?: number }).code !== 11000) throw error;
		const retry = await collection().findOneAndUpdate(
			{ _id: id, windowStart: { $gte: windowStart } },
			{ $inc: { count: 1 } },
			{ returnDocument: 'after' },
		);
		if (retry.value && retry.value.count > limit) {
			throw new HttpError(429, 'rate_limited', `Too many requests for ${bucket}; limit is ${limit}`);
		}
		return retry.value?.count ?? 1;
	}
}