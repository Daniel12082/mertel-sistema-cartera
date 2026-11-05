import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npm';
let stopping = false;
let exitCode = 0;

const applications = [
  { name: 'backend', directory: 'backend' },
  { name: 'frontend', directory: 'frontend' },
];

const children = applications.map(({ name, directory }) => {
  const child = spawn(npmCommand, isWindows ? ['/d', '/s', '/c', 'npm run dev'] : ['run', 'dev'], {
    cwd: resolve(rootDirectory, directory),
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    console.error(`No se pudo iniciar ${name}: ${error.message}`);
    shutdown(1);
  });

  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`${name} se detuvo${signal ? ` (${signal})` : ` (código ${code ?? 1})`}.`);
      shutdown(code ?? 1);
    }
  });

  return child;
});

function shutdown(code = 0) {
  if (stopping) return;

  stopping = true;
  exitCode = code;
  children.forEach((child) => {
    if (!child.killed) child.kill();
  });

  setTimeout(() => process.exit(exitCode), 400).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('Iniciando MERTEL: backend y frontend. Para detenerlos, presiona Ctrl+C.');
