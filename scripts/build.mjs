import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
await build({ entryPoints: ['src/extension.ts'], outfile: 'dist/extension.cjs', bundle: true,
  platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'], sourcemap: true });
const licenses = [
  ['confbox', 'LICENSE'], ['confbox', 'dist/THIRD-PARTY-LICENSES.md'],
  ['minimatch', 'LICENSE.md'], ['brace-expansion', 'LICENSE'], ['balanced-match', 'LICENSE.md']
];
const notices = await Promise.all(licenses.map(async ([name, file]) => `## ${name}\n\n${await readFile(`node_modules/${name}/${file}`, 'utf8')}`));
await writeFile('dist/THIRD-PARTY-NOTICES.txt', notices.join('\n\n'));
