import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requirements = path.resolve(serverRoot, '../Image-forensics/requirements.txt');
const venvDir = path.join(serverRoot, '.venv');
const systemPython = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const venvPython =
  process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');

if (!fs.existsSync(requirements)) {
  console.error(`Python requirements not found at ${requirements}`);
  process.exit(1);
}

if (!fs.existsSync(venvPython)) {
  console.log(`Creating Python environment at ${venvDir}`);
  const created = spawnSync(systemPython, ['-m', 'venv', venvDir], { stdio: 'inherit' });
  if (created.status !== 0) {
    console.error('Could not create the Python virtual environment. Install Python 3 and try again.');
    process.exit(created.status ?? 1);
  }
}

console.log('Installing Image-forensics Python packages...');
const installed = spawnSync(venvPython, ['-m', 'pip', 'install', '-r', requirements], { stdio: 'inherit' });
process.exit(installed.status ?? 1);
