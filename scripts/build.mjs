import { spawnSync } from 'node:child_process';

const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const hasTinaCloudCredentials = Boolean(
	process.env.NEXT_PUBLIC_TINA_CLIENT_ID && process.env.TINA_TOKEN,
);

const tinaArgs = ['exec', 'tinacms', 'build', '--skip-indexing'];
if (!hasTinaCloudCredentials) tinaArgs.push('--local', '--skip-cloud-checks');

function run(args) {
	const result = spawnSync(packageManager, args, {
		stdio: 'inherit',
		shell: process.platform === 'win32',
		env: { ...process.env, NODE_ENV: 'production' },
	});
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

run(tinaArgs);
run(['exec', 'astro', 'build']);
