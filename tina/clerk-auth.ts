import { Clerk } from '@clerk/backend';
import { logger } from './logger';

type NodeRequest = {
	headers?: Record<string, string | string[] | undefined>;
	url?: string;
};

type ClerkAuthOptions = {
	secretKey: string;
	allowList?: string[];
	orgId?: string;
};

/**
 * Clerk's Tina adapter only reads Authorization headers. Astro's preview
 * iframe also renders the page on the server, where the browser session is
 * carried by Clerk's cookie. Build a Web Request from the Node request so
 * Clerk can validate either carrier.
 */
export function ClerkBackendAuthenticationForAstro({
	secretKey,
	allowList,
	orgId,
}: ClerkAuthOptions) {
	const clerk = Clerk({ secretKey });

	return {
		isAuthorized: async (req: NodeRequest) => {
			const headers = new Headers();
			for (const [name, value] of Object.entries(req.headers ?? {})) {
				if (Array.isArray(value)) headers.set(name, value.join(', '));
				else if (value) headers.set(name, value);
			}

			const request = new Request(
				`http://${headers.get('host') || 'localhost'}${req.url || '/'}`,
				{ headers },
			);
			const cookieToken = headers
				.get('cookie')
				?.split(';')
				.map((part) => part.trim())
				.find((part) => part.startsWith('tina_clerk_token='))
				?.slice('tina_clerk_token='.length);
			const requestState = await clerk.authenticateRequest({
				request,
				...(cookieToken ? { headerToken: decodeURIComponent(cookieToken) } : {}),
			});

			if (requestState.status === 'signed-in') {
				const user = await clerk.users.getUser(requestState.toAuth().userId);
				if (orgId) {
					const memberships = await clerk.organizations.getOrganizationMembershipList({
						organizationId: orgId,
					});
					if (!memberships.some((membership) => membership.publicUserData?.userId === user.id)) {
						return {
							isAuthorized: false,
							errorMessage: 'User not authorized for this organization.',
							errorCode: 401,
						};
					}
				}

				const primaryEmail = user.emailAddresses.find(
					({ id }) => id === user.primaryEmailAddressId,
				);
				if (
					primaryEmail &&
					(!allowList || allowList.includes(primaryEmail.emailAddress))
				) {
					// The Tina API handler forwards `req.session.user` to `resolve()` as
					// `ctxUser`. Our database proxy uses the same identity to pick the
					// per-user draft namespace.
					(req as { session?: { user?: { id: string } } }).session = {
						user: { id: user.id },
					};
					return { isAuthorized: true };
				}
			}

			if (requestState.reason === 'unexpected-error') {
				logger.error('tina.auth.clerk_unexpected_error', { message: requestState.message });
			}
			return {
				isAuthorized: false,
				errorMessage: 'User not authorized',
				errorCode: 401,
			};
		},
	};
}
