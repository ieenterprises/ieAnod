import {
  createCipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
} from 'node:crypto';
import { chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const seed = process.env.RENDER_SECRET_SEED || 'nod-render-default-seed';
const dataRoot = process.env.NOD_DATA_ROOT || '/var/lib/nod';
const ownerId = 'local-development';

process.env.NOD_HOST = process.env.NOD_HOST || '0.0.0.0';
process.env.NOD_RELAX_HOST_CHECK = process.env.NOD_RELAX_HOST_CHECK || 'true';
process.env.PORT = process.env.PORT || '10000';
if (!process.env.NOD_PUBLIC_URL) {
  process.env.NOD_PUBLIC_URL =
    process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT}`;
}
if (!process.env.NOD_AUTH_TOKEN || !/^[A-Za-z0-9_-]{43,}$/.test(process.env.NOD_AUTH_TOKEN)) {
  process.env.NOD_AUTH_TOKEN = createHash('sha256').update(`nod-auth:${seed}`).digest('hex');
}
if (!process.env.NOD_VAULT_KEY) {
  process.env.NOD_VAULT_KEY = createHash('sha256').update(`nod-vault:${seed}`).digest('base64');
}

async function ensureDirectoriesAndIdentity() {
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  await chmod(dataRoot, 0o700);
  const workspaces = join(dataRoot, 'workspaces');
  await mkdir(workspaces, { recursive: true, mode: 0o700 });
  const identityDir = join(dataRoot, 'integration-identity');
  await mkdir(identityDir, { recursive: true, mode: 0o700 });
  await chmod(identityDir, 0o700);

  const name = createHash('sha256').update(ownerId).digest('hex');
  const encryptedPath = join(identityDir, `${name}.encrypted`);
  const publicPath = join(identityDir, `${name}.public`);

  const exists = await stat(encryptedPath)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    const keySeed = createHash('sha256').update(`nod-identity:${seed}`).digest();
    const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
    const der = Buffer.concat([pkcs8Prefix, keySeed]);
    const privateKey = createPrivateKey({ key: der, type: 'pkcs8', format: 'der' });
    const publicKey = createPublicKey(privateKey).export({ format: 'jwk' }).x;

    const encryptionKey = Buffer.from(process.env.NOD_VAULT_KEY.trim(), 'base64');
    const binding = Buffer.from(JSON.stringify(['nod-integration-identity-v1', ownerId]));
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
    cipher.setAAD(binding);
    const ciphertext = Buffer.concat([cipher.update(der), cipher.final()]);
    const payload = Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);

    await writeFile(encryptedPath, payload, { mode: 0o600 });
    await chmod(encryptedPath, 0o600);
    await writeFile(publicPath, Buffer.from(publicKey), { mode: 0o600 });
    await chmod(publicPath, 0o600);
  }
}

await ensureDirectoriesAndIdentity();

const browserWorker = spawn('node', ['/app/worker.mjs'], {
  stdio: 'inherit',
  env: process.env,
});

console.log('\n============================================================');
console.log('NOD IS STARTING ON RENDER');
console.log(`PUBLIC URL:  ${process.env.NOD_PUBLIC_URL}`);
console.log(`AUTH TOKEN:  ${process.env.NOD_AUTH_TOKEN}`);
console.log('============================================================\n');

const server = spawn('node', ['--import', 'tsx', '/app/src/server/index.ts'], {
  stdio: 'inherit',
  env: process.env,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.kill(signal);
    browserWorker.kill(signal);
  });
}

server.on('exit', (code) => {
  browserWorker.kill('SIGTERM');
  process.exit(code ?? 0);
});
