import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const watch = process.argv.includes('--watch');
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const forensicsSrc = path.resolve(serverRoot, '../Image-forensics/src');
const venvPython =
  process.platform === 'win32'
    ? path.join(serverRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(serverRoot, '.venv', 'bin', 'python');
const python =
  process.env.PYTHON ||
  (fs.existsSync(venvPython) ? venvPython : process.platform === 'win32' ? 'python' : 'python3');
const tsxBin = path.join(
  serverRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
);

const children: ChildProcess[] = [];
let shuttingDown = false;

function prefix(name: string, chunk: Buffer, stream: NodeJS.WriteStream) {
  const text = chunk.toString();
  for (const line of text.split('\n')) {
    if (line.trim().length > 0) stream.write(`[${name}] ${line}\n`);
  }
}

function run(name: string, command: string, args: string[], cwd: string) {
  const child = spawn(command, args, { cwd, env: process.env, stdio: ['inherit', 'pipe', 'pipe'] });
  children.push(child);
  child.stdout?.on('data', (chunk: Buffer) => prefix(name, chunk, process.stdout));
  child.stderr?.on('data', (chunk: Buffer) => prefix(name, chunk, process.stderr));
  child.on('exit', (code, signal) => {
    if (shuttingDown || signal) return;
    console.error(`[${name}] exited with code ${code ?? 1}`);
    shutdown(code ?? 1);
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 200);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run(
  'forensics',
  python,
  ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', '8000', ...(watch ? ['--reload'] : [])],
  forensicsSrc
);

run('api', tsxBin, [...(watch ? ['watch'] : []), 'src/server.ts'], serverRoot);
