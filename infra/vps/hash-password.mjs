#!/usr/bin/env node
// Membuat hash scrypt untuk ADMIN_PASSWORD_HASH / MANAGERIAL_PASSWORD_HASH.
// Format sama dengan packages/auth/src/password.ts: scrypt:<salt hex>:<hash hex>
//
// Pakai (password dibaca dari prompt tersembunyi, tidak masuk riwayat shell):
//   node infra/vps/hash-password.mjs
//
// Tanpa dependensi, tidak perlu pnpm install.

import { randomBytes, scryptSync } from 'node:crypto';

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('Skrip ini butuh terminal interaktif (TTY).'));
      return;
    }
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          process.stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1);
        } else {
          value += ch;
        }
      }
    };
    process.stdin.on('data', onData);
  });
}

const first = await readHidden('Password: ');
if (first === '') {
  console.error('Password tidak boleh kosong.');
  process.exit(1);
}
const second = await readHidden('Ulangi password: ');
if (first !== second) {
  console.error('Password tidak sama.');
  process.exit(1);
}

const salt = randomBytes(16);
const key = scryptSync(first, salt, 64);
console.log(`scrypt:${salt.toString('hex')}:${key.toString('hex')}`);
