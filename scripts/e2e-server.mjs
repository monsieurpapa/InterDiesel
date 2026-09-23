// Starts the built server on a throw-away database filled with the demo data.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const port = process.argv[2] ?? '3100';
const dataDir = mkdtempSync(join(tmpdir(), 'interdiesel-e2e-'));
const env = { ...process.env, DATA_DIR: dataDir, PORT: port };
execFileSync('node', ['dist/cli.mjs', 'demo'], { env, stdio: 'inherit' });
const child = spawn('node', ['dist/index.mjs'], { env, stdio: 'inherit' });
process.on('SIGTERM', () => child.kill());
process.on('SIGINT', () => child.kill());
