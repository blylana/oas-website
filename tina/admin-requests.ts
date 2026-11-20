// A revision belongs to the content this tab loaded. Polling the workspace must
// not silently grant an old form permission to write into a new workspace.
declare global {
	interface Window {
		__OAS_SAVE_RECEIPT__?: number;
	}
}

export function installAdminRequests(getToken: () => Promise<string | null | undefined>) {
	const fetchRequest = window.fetch.bind(window);
	let revision: string | null = null;
	window.fetch = async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : String(input), location.href);
		const isGraphQL = url.pathname === '/api/tina/gql';
		const isReview = ['/api/tina/workspace', '/api/tina/submit', '/api/tina/discard'].includes(url.pathname);
		if (url.origin !== location.origin || (!isGraphQL && !isReview)) {
			return fetchRequest(input, init);
		}

		const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
		if (isReview) {
			const token = await getToken();
			if (token) headers.set('Authorization', `Bearer ${token}`);
		}
		if (revision) headers.set('x-oas-edit-revision', revision);
		const response = await fetchRequest(input, { ...init, headers });
		const observedRevision = response.headers.get('x-oas-edit-revision');
		if (response.ok && observedRevision && revision === null) revision = observedRevision;
		if (response.ok && response.headers.get('x-oas-save-received') === 'true') {
			window.__OAS_SAVE_RECEIPT__ = (window.__OAS_SAVE_RECEIPT__ ?? 0) + 1;
		}
		return response;
	};
}
