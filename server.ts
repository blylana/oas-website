import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TinaNodeBackend, LocalBackendAuthProvider } from '@tinacms/datalayer';
import databaseClient from './tina/__generated__/databaseClient';
import { ClerkBackendAuthenticationForAstro } from './tina/clerk-auth';

// Astro's generated entry can start its own listener unless this is disabled
// before importing it. Express owns the production listener in this setup.
process.env.ASTRO_NODE_AUTOSTART = 'disabled';
const { handler: astroHandler } = await import('./dist/server/entry.mjs');

const app = express();
const port = Number(process.env.PORT || 4321);
const clientDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist/client');

app.use(express.json({ limit: '10mb' }));

const isLocal = process.env.TINA_PUBLIC_IS_LOCAL === 'true';
const tinaHandler = TinaNodeBackend({
	authProvider: isLocal
		? LocalBackendAuthProvider()
		: ClerkBackendAuthenticationForAstro({
				secretKey: process.env.CLERK_SECRET_KEY!,
				allowList: process.env.TINA_PUBLIC_ALLOWED_EMAIL
					? [process.env.TINA_PUBLIC_ALLOWED_EMAIL]
					: undefined,
				orgId: process.env.TINA_PUBLIC_CLERK_ORG_ID,
			}),
	databaseClient,
});

app.use((req, res, next) => {
	if (req.url.startsWith('/api/tina')) {
		return tinaHandler(req, res);
	}
	return next();
});

// Serve prerendered pages and Tina's static admin assets from the production build.
app.use(express.static(clientDir));

// Static hosting serves the public pages and admin assets. Astro only needs
// to handle the on-demand Tina island refresh endpoint on this server.
app.use((req, res, next) => {
	if (req.path.startsWith('/tina-island/')) {
		return astroHandler(req, res, next);
	}
	return next();
});

app.listen(port, () => {
	console.log(`OnmyojiAutoScript website listening on http://localhost:${port}`);
});
