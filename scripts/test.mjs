import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
const entries = readdirSync('test').filter(p => p.endsWith('.test.ts')).map(p => `test/${p}`);
const jsEntries = readdirSync('test').filter(p => p.endsWith('.test.mjs')).map(p => `test/${p}`);
await build({ entryPoints: entries, outdir: '.test-build', bundle: true, platform: 'node', format: 'esm', target: 'node20', alias: { vscode: './test/vscode-mock.ts' } });
await build({ entryPoints: ['src/view.ts'], outfile: '.test-build/view.js', bundle: true, platform: 'node', format: 'esm' });
const result = spawnSync(process.execPath, ['--test', ...entries.map(p => p.replace('test/', '.test-build/').replace('.ts', '.js')), ...jsEntries], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
