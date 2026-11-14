import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const windowsToolchain = process.platform === 'win32';
const command = windowsToolchain ? 'powershell.exe' : 'cargo';
const args = windowsToolchain
  ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('scripts/test-contract.ps1')]
  : ['test', '--manifest-path', 'contracts/payroll-vault/Cargo.toml', '--lib', '--locked'];
const child = spawn(command, args, { stdio: 'inherit', windowsHide: true });
child.on('error', () => {
  console.error(
    'Rust toolchain unavailable. Install Rust and the native platform build prerequisites, then run npm run test:contract.',
  );
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
