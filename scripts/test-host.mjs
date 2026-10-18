import { runTests } from '@vscode/test-electron';
import { build } from 'esbuild';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = process.cwd();
const testDirectory = await realpath(await mkdtemp(path.join(tmpdir(), 'gwb-')));
const repo = path.join(testDirectory, 'repository');
const { mkdir } = await import('node:fs/promises');
await mkdir(repo);
const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
git(['init', '-b', 'main']);
git(['config', 'user.name', 'Host Test']);
git(['config', 'user.email', 'host@example.com']);
git(['config', 'commit.gpgsign', 'false']);
await writeFile(path.join(repo, 'tracked.txt'), 'original\n');
git(['add', '.']);
git(['commit', '-m', 'initial']);
await writeFile(path.join(repo, 'tracked.txt'), 'edited\n');
await writeFile(path.join(repo, 'untracked.txt'), 'new file\n');
await build({
  entryPoints: ['tests/host.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
  outfile: 'dist/test-host.cjs',
});
try {
  await runTests({
    vscodeExecutablePath:
      process.env.VSCODE_EXECUTABLE_PATH || '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'dist/test-host.cjs'),
    extensionTestsEnv: { GIT_WORKBENCH_TEST_REPO: repo, GIT_WORKBENCH_EXTENSION_ROOT: root },
    launchArgs: [
      repo,
      '--user-data-dir',
      path.join(testDirectory, 'profile'),
      '--extensions-dir',
      path.join(testDirectory, 'extensions'),
      '--disable-extension',
      'github.copilot-chat',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-updates',
      '--disable-telemetry',
      '--locale=en',
    ],
  });
} finally {
  await rm(testDirectory, { recursive: true, force: true });
}
