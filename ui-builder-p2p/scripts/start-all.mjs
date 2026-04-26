import { spawn } from 'node:child_process';

function run(name, command) {
  const child = spawn(command, {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
    }
  });
  return child;
}

const children = [
  run('ui', 'npm run dev:ui'),
  run('signal', 'npm run dev:signal'),
  run('api', 'npm run dev:api'),
];

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
