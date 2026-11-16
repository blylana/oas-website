import { Clerk } from '@clerk/clerk-js';
import { ui } from '@clerk/ui';
import { ClerkAuthProvider } from 'tinacms-clerk/dist/tinacms';
import { defineConfig, LocalAuthProvider } from 'tinacms';

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true';
const clerk = new Clerk(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '');

class AstroClerkAuthProvider extends ClerkAuthProvider {
	async getToken() {
		const token = await super.getToken();
		writeClerkTokenCookie(token?.id_token || token?.access_token);
		return token;
	}
}

function writeClerkTokenCookie(value?: string) {
	if (typeof document !== 'undefined' && value) {
		document.cookie = `tina_clerk_token=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
	}
}

if (typeof window !== 'undefined') {
	const loadClerk = clerk.load.bind(clerk);
	clerk.load = (options = {}) => loadClerk({ ui, ...options });
	const syncClerkToken = async () => {
		await clerk.load({ ui });
		writeClerkTokenCookie(await clerk.session?.getToken());
	};
	void syncClerkToken();
	clerk.addListener(() => void syncClerkToken());
}

// Your hosting provider likely exposes this as an environment variable
const branch =
  process.env.GITHUB_BRANCH ||
  process.env.VERCEL_GIT_COMMIT_REF ||
  process.env.HEAD ||
  // This checkout is developed on the `tina` branch. Keep the fallback a
  // plain string because Tina bundles this config into the browser Admin app.
  'tina';

export default defineConfig({
  branch,
	authProvider: isLocal
		? new LocalAuthProvider()
		: new AstroClerkAuthProvider({
				clerk,
				allowedList: process.env.TINA_PUBLIC_ALLOWED_EMAIL
					? [process.env.TINA_PUBLIC_ALLOWED_EMAIL]
					: undefined,
				orgId: process.env.TINA_PUBLIC_CLERK_ORG_ID,
			}),
	contentApiUrlOverride: '/api/tina/gql',
  // Get this from tina.io
  clientId: process.env.NEXT_PUBLIC_TINA_CLIENT_ID,
  // Get this from tina.io
  token: process.env.TINA_TOKEN,
  build: {
    outputFolder: 'admin',
    publicFolder: 'public',
  },
  // Uncomment to allow cross-origin requests from non-localhost origins
  // during local development (e.g. GitHub Codespaces, Gitpod, Docker).
  // Use 'private' to allow all private-network IPs (WSL2, Docker, etc.)
  // server: {
  //   allowedOrigins: ['https://your-codespace.github.dev'],
  // },
  media: {
    tina: {
      mediaRoot: '',
      publicFolder: 'public',
    },
  },
  // See docs on content modeling for more info on how to setup new content models: https://tina.io/docs/r/content-modelling-collections/
  schema: {
    collections: [
      {
        name: 'docs',
        label: 'Documentation',
        path: 'src/content/docs',
        format: 'mdx',
        match: {
          // The landing page contains Starlight component imports and is not
          // a Tina rich-text document.
          exclude: 'index.mdx',
        },
        ui: {
          router: ({ document }) => {
            const slug = document?._sys?.breadcrumbs?.join('/');
            // Tina mounts the preview iframe on the current origin. Return a
            // site-relative path so the host is not concatenated twice.
            return slug ? `/${slug}` : '/';
          },
        },
        fields: [
          {
            type: 'string',
            name: 'title',
            label: 'Title',
            isTitle: true,
            required: true,
          },
          {
            type: 'string',
            name: 'description',
            label: 'Description',
          },
          {
            type: 'rich-text',
            name: 'body',
            label: 'Content',
            isBody: true,
          },
        ],
      },
    ],
  },
});
