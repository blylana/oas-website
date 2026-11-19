import { Clerk } from '@clerk/clerk-js';
import { ui } from '@clerk/ui';
import { ClerkAuthProvider } from 'tinacms-clerk/dist/tinacms';
import { defineConfig, LocalAuthProvider } from 'tinacms';

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true';
const clerk = new Clerk(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '');

class AstroClerkAuthProvider extends ClerkAuthProvider {
  async getToken() {
    const token = await super.getToken();
    const value = token as { id_token?: string; access_token?: string } | null;
    writeClerkTokenCookie(value?.id_token || value?.access_token);
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
    // 加载 Clerk；
    // 获取当前会话的 Token；
    // 将 Token 写入 Cookie；
    // 如果没有 Token，则写入 undefined，通常表示清除或更新 Cookie。
    writeClerkTokenCookie((await clerk.session?.getToken()) ?? undefined);
  };
  // 页面初始化时立即同步一次 Token；
  void syncClerkToken();
  clerk.addListener(() => void syncClerkToken());

  // Tina can read the GitHub token only after the user has linked GitHub in
  // Clerk. A save request cannot start an OAuth redirect from XHR, so expose
  // an explicit consent action for the admin status/error UI.
  // 挂载一个全局函数，方便页面上的按钮或管理后台调用
  (window as typeof window & { __OAS_CONNECT_GITHUB__?: () => Promise<void> })
    .__OAS_CONNECT_GITHUB__ = async () => {
      try {
        await clerk.load({ ui });
        if (!clerk.user) {
          (clerk as unknown as { openSignIn?: () => void }).openSignIn?.();
          return;
        }
        const redirectUrl = window.location.pathname;
        const additionalScopes = ['public_repo'] as never[];
        const existing = clerk.user.externalAccounts.find(
          (account) => account.provider === 'github',
        );
        // 复用已有账号或创建新账号
        const resource = existing
          ? await existing.reauthorize({ redirectUrl, additionalScopes })
          : await clerk.user.createExternalAccount({
            strategy: 'oauth_github' as never,
            redirectUrl,
            additionalScopes,
          });
        // 跳转到 GitHub 授权页面
        const target = resource.verification?.externalVerificationRedirectURL;
        if (target) window.location.assign(target.href);
        else window.location.reload();
      } catch (error) {
        console.error('GitHub authorization failed', error);
        window.alert('GitHub 授权没有完成，请再试一次。');
      }
    };
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
      static: true,
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
