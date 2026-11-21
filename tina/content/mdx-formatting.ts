import { isDeepStrictEqual } from 'node:util';
import { parseFile, stringifyFile } from '@tinacms/graphql';
import { parseMDX, serializeMDX } from '@tinacms/mdx';
import { diff3Merge } from 'node-diff3';

const bodyField: Parameters<typeof parseMDX>[1] = {
	type: 'rich-text',
	name: 'body',
	isBody: true,
};
const keepImagePath = (path: string) => path;

function readMdx(source: string) {
	const { $_body, ...fields } = parseFile<{ $_body: string }>(source, '.mdx', (yup) => yup.object({}));
	const parsed = parseMDX($_body, bodyField, keepImagePath);
	if (parsed.children[0]?.type === 'invalid_markdown') return;
	const body = serializeMDX(parsed, bodyField, keepImagePath);
	if (body !== undefined && typeof body !== 'string') return;
	return { ...fields, $_body: body };
}

export function preserveMdxFormatting(original: string, edited: string): string {
	if (original === edited) return original;
	try {
		const originalDocument = readMdx(original);
		if (!originalDocument) return edited;
		// Use Tina's serialized original as the common base. The two sides are
		// the original formatting and Tina's version with the user's edits.
		const baseline = stringifyFile(originalDocument, '.mdx', false);
		if (baseline === original) return edited;
		const result = diff3Merge(Array.from(original), Array.from(baseline), Array.from(edited));
		// Where an edit overlaps a formatting change, take the edited region.
		const candidate = result.map((part) => (part.ok ?? part.conflict!.b).join('')).join('');
		const editedDocument = readMdx(edited);
		if (editedDocument && isDeepStrictEqual(readMdx(candidate), editedDocument)) return candidate;
	} catch {
		// Use Tina's output when the original or the merged candidate cannot be parsed.
	}
	return edited;
}
