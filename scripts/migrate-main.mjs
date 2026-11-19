/**
 * Copy the current `tina` namespace into `main` in the new `tinacms` collection.
 *
 *   node scripts/migrate-main.mjs            # keep the old collection
 *   node scripts/migrate-main.mjs --drop-old # delete tinacms-tina afterwards
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const SEP = '\x1d';
const SOURCE_COLLECTION = 'tinacms-tina';
const TARGET_COLLECTION = 'tinacms';
const SOURCE_NS = 'tina';
const TARGET_NS = 'main';

const contentPrefix = (ns) => `${SEP}_content${SEP}${SEP}${ns}${SEP}`;
const metaPrefix = (ns) => `${SEP}_metadata${SEP}${SEP}${ns}${SEP}`;
const range = (prefix) => ({ $gte: prefix, $lt: `${prefix}\uffff` });

const convertKey = (key, from, to) => {
	for (const [fromPrefix, toPrefix] of [
		[contentPrefix(from), contentPrefix(to)],
		[metaPrefix(from), metaPrefix(to)],
	]) {
		if (key.startsWith(fromPrefix)) {
			return toPrefix + key.slice(fromPrefix.length);
		}
	}
	return key;
};

const uri = process.env.MONGODB_URI;
if (!uri) {
	console.error('MONGODB_URI is missing');
	process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db('tinacms');
const source = db.collection(SOURCE_COLLECTION);
const target = db.collection(TARGET_COLLECTION);

const [content, metadata] = await Promise.all([
	source.find({ key: range(contentPrefix(SOURCE_NS)) }).toArray(),
	source.find({ key: range(metaPrefix(SOURCE_NS)) }).toArray(),
]);
const docs = [...content, ...metadata].map((doc) => ({
	key: convertKey(doc.key, SOURCE_NS, TARGET_NS),
	value: doc.value,
}));

if (!docs.length) {
	console.error(`No rows found in ${SOURCE_COLLECTION} under namespace "${SOURCE_NS}"`);
	process.exit(1);
}

await target.deleteMany({ key: range(contentPrefix(TARGET_NS)) });
await target.deleteMany({ key: range(metaPrefix(TARGET_NS)) });
await target.insertMany(docs, { ordered: false });
await target.createIndex({ key: 1 }, { unique: true });

const targetCount = await target.countDocuments({
	key: { $gte: contentPrefix(TARGET_NS), $lt: `${contentPrefix(TARGET_NS)}\uffff` },
});
const metaCount = await target.countDocuments({
	key: { $gte: metaPrefix(TARGET_NS), $lt: `${metaPrefix(TARGET_NS)}\uffff` },
});

console.log(`copied ${docs.length} rows (${content.length} content + ${metadata.length} metadata)`);
console.log(`target: ${targetCount} content rows, ${metaCount} metadata rows`);

if (docs.length !== targetCount + metaCount) {
	console.error('count mismatch, keeping old collection');
	process.exitCode = 1;
} else if (process.argv.includes('--drop-old')) {
	await source.drop();
	console.log(`dropped ${SOURCE_COLLECTION}`);
} else {
	console.log('old collection kept; pass --drop-old to remove it');
}

await client.close();