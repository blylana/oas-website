import { MongoClient } from 'mongodb';

const DB_NAME = 'tinacms';

let client: MongoClient | undefined;

export function getMongo(): MongoClient {
	if (!client) {
		const uri = process.env.MONGODB_URI;
		if (!uri) {
			throw new Error('MONGODB_URI is required');
		}
		client = new MongoClient(uri, { maxPoolSize: 10 });
	}
	return client;
}

export function appDb() {
	return getMongo().db(DB_NAME);
}