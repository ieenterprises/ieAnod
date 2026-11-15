import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { chmod, link, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { pool } from './db.ts';

const token = /^[A-Za-z0-9_-]{43}$/;

async function localKey(dataRoot: string, name: 'access-key' | 'credential-request-key') {
  const path = join(dataRoot, name);
  if (!token.test(await readFile(path, 'utf8').catch(() => ''))) {
    await mkdir(dataRoot, { recursive: true, mode: 0o700 });
    const draft = `${path}.${randomUUID()}`;
    await writeFile(draft, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 });
    await link(draft, path)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      })
      .finally(() => rm(draft, { force: true }));
  }
  const info = await lstat(path);
  const key = info.isFile() ? await readFile(path, 'utf8') : '';
  if (!token.test(key)) throw new Error(`Delete ${path} and restart Nod.`);
  if (info.mode & 0o077) await chmod(path, 0o600);
  return key;
}

export const accessKey = (dataRoot: string) => localKey(dataRoot, 'access-key');
export const credentialRequestKey = (dataRoot: string) =>
  localKey(dataRoot, 'credential-request-key');

export const accessCookie = (port: number) => `nod-access-${port}`;

export function registerLocalAccess(
  app: FastifyInstance,
  port: number,
  access: { key: string; desktop?: boolean; origin?: string; bearer?: boolean },
) {
  const desktop = access.desktop === true;
  const origin = access.origin ? new URL(access.origin) : undefined;
  const hosts = new Set(
    desktop
      ? [`127.0.0.1:${port}`]
      : origin
        ? [origin.host]
        : [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`],
  );
  const expected = Buffer.from(access.key);
  const cookie = accessCookie(port);
  const matches = (value: unknown) => {
    const actual = typeof value === 'string' ? Buffer.from(value) : undefined;
    return !!actual && actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  const presented = (request: FastifyRequest) =>
    desktop
      ? request.headers['x-nod-desktop-token']
      : access.bearer && request.headers.authorization !== undefined
        ? /^Bearer ([^\s]+)$/i.exec(request.headers.authorization)?.[1]
        : request.headers.cookie
            ?.split(';')
            .map((part) => part.trim())
            .find((part) => part.startsWith(`${cookie}=`))
            ?.slice(cookie.length + 1);
  const pages = new Set([
    '/',
    '/tasks',
    '/memory',
    '/usage',
    '/vault',
    '/trust',
    '/apps',
    '/onboarding',
    '/connected.html',
    '/channels',
    '/settings',
    '/settings/models',
    '/settings/apps',
    '/settings/memory',
    '/browser',
    '/privacy',
    '/privacy/',
  ]);
  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('Cache-Control', 'no-store')
      .header('Content-Security-Policy', "frame-ancestors 'none'");
    const path = request.url.split('?')[0];
    const relaxHost = process.env.NOD_RELAX_HOST_CHECK === 'true';
    if (path === '/healthz') return reply.code(200).send({ ok: true });
    if (!relaxHost && !hosts.has(request.headers.host || ''))
      return reply.code(403).send({ error: 'This host is not permitted.' });
    if (
      !desktop &&
      request.method === 'POST' &&
      ['/api/webhooks/composio', '/api/webhooks/telegram', '/api/webhooks/whatsapp'].includes(path)
    )
      return;
    if (!desktop && request.method === 'GET' && path === '/api/webhooks/whatsapp') return;
    if (!relaxHost && request.headers.origin) {
      let requested: URL;
      try {
        requested = new URL(request.headers.origin);
      } catch {
        return reply.code(403).send({ error: 'Invalid origin.' });
      }
      if (
        (origin
          ? request.headers.origin !== origin.origin
          : requested.protocol !== 'http:' ||
            request.headers.origin !== requested.origin ||
            !hosts.has(requested.host)) ||
        (desktop && request.headers.origin !== `http://127.0.0.1:${port}`)
      )
        return reply.code(403).send({ error: 'This origin is not permitted.' });
    }
    const pageNavigation =
      request.method === 'GET' &&
      (pages.has(path) || /^\/(vault|credentials|payments)\/[A-Za-z0-9_-]+\/?$/.test(path)) &&
      request.headers['sec-fetch-mode'] === 'navigate' &&
      request.headers['sec-fetch-dest'] === 'document';
    const state = new URLSearchParams(request.url.split('?')[1]).getAll('state');
    const appCallback =
      request.method === 'GET' &&
      ['/api/apps/callback', '/api/models/oauth/callback'].includes(path) &&
      state.length === 1 &&
      token.test(state[0]);
    const connectionBridge =
      !desktop &&
      ['GET', 'POST'].includes(request.method) &&
      /^\/api\/apps\/connect\/[A-Za-z0-9_-]{43}$/.test(request.url);
    const open =
      appCallback ||
      connectionBridge ||
      (!desktop &&
        ((request.method === 'POST' &&
          [
            '/api/access',
            '/api/auth/signup',
            '/api/auth/signin',
            '/api/auth/signout',
          ].includes(path)) ||
          (request.method === 'GET' && path === '/api/privacy')));
    if (
      !open &&
      (path === '/api' ||
        path.startsWith('/api/') ||
        request.routeOptions.url?.startsWith('/api/')) &&
      !matches(presented(request))
    )
      return reply.code(401).send({
        error: desktop
          ? 'Open Nod in the desktop app.'
          : access.bearer
            ? 'Enter your server authentication token.'
            : 'Open Nod from the link in your terminal.',
      });
    if (
      request.headers['sec-fetch-site'] === 'cross-site' &&
      !appCallback &&
      !pageNavigation &&
      !(
        connectionBridge &&
        request.method === 'GET' &&
        request.headers['sec-fetch-mode'] === 'navigate' &&
        request.headers['sec-fetch-dest'] === 'document'
      )
    )
      return reply.code(403).send({ error: 'Cross-site requests are not permitted.' });
  });
  if (!desktop) {
    const cookieHeader = (maxAge = 34560000) =>
      `${cookie}=${maxAge > 0 ? access.key : ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${origin?.protocol === 'https:' ? '; Secure' : ''}`;

    app.post('/api/access', { bodyLimit: 4096 }, async (request, reply) => {
      if (!matches((request.body as { key?: unknown } | undefined)?.key))
        return reply.code(401).send({ error: 'This link is no longer valid.' });
      return reply.header('Set-Cookie', cookieHeader()).code(204).send();
    });

    app.post('/api/auth/signup', { bodyLimit: 8192 }, async (request, reply) => {
      const body = (request.body ?? {}) as {
        name?: unknown;
        email?: unknown;
        password?: unknown;
      };
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (!name || name.length > 120)
        return reply.code(400).send({ error: 'Please enter your full name.' });
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
        return reply.code(400).send({ error: 'Please enter a valid email address.' });
      if (password.length < 6 || password.length > 200)
        return reply.code(400).send({ error: 'Password must be at least 6 characters.' });

      await pool.query(`
        CREATE TABLE IF NOT EXISTS ieanod_users (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          name text NOT NULL,
          email text UNIQUE NOT NULL,
          password_hash text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      const existing = await pool.query('SELECT id FROM ieanod_users WHERE email = $1', [email]);
      if (existing.rowCount && existing.rowCount > 0)
        return reply
          .code(409)
          .send({ error: 'An account with this email already exists. Please sign in.' });

      const salt = randomBytes(16).toString('hex');
      const derived = scryptSync(password, salt, 64).toString('hex');
      const passwordHash = `${salt}:${derived}`;
      await pool.query(
        'INSERT INTO ieanod_users (name, email, password_hash) VALUES ($1, $2, $3)',
        [name, email, passwordHash],
      );
      return reply
        .header('Set-Cookie', cookieHeader())
        .code(200)
        .send({ ok: true, user: { name, email } });
    });

    app.post('/api/auth/signin', { bodyLimit: 8192 }, async (request, reply) => {
      const body = (request.body ?? {}) as { email?: unknown; password?: unknown };
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (!email || !password)
        return reply.code(400).send({ error: 'Please enter your email and password.' });

      await pool.query(`
        CREATE TABLE IF NOT EXISTS ieanod_users (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          name text NOT NULL,
          email text UNIQUE NOT NULL,
          password_hash text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      const result = await pool.query<{ name: string; email: string; password_hash: string }>(
        'SELECT name, email, password_hash FROM ieanod_users WHERE email = $1',
        [email],
      );
      const row = result.rows[0];
      if (!row)
        return reply.code(401).send({ error: 'Invalid email or password.' });
      const [salt, storedHex] = row.password_hash.split(':');
      if (!salt || !storedHex)
        return reply.code(401).send({ error: 'Invalid email or password.' });
      const derived = scryptSync(password, salt, 64);
      const expectedBuf = Buffer.from(storedHex, 'hex');
      if (derived.length !== expectedBuf.length || !timingSafeEqual(derived, expectedBuf))
        return reply.code(401).send({ error: 'Invalid email or password.' });

      return reply
        .header('Set-Cookie', cookieHeader())
        .code(200)
        .send({ ok: true, user: { name: row.name, email: row.email } });
    });

    app.post('/api/auth/signout', { bodyLimit: 4096 }, async (_request, reply) => {
      return reply.header('Set-Cookie', cookieHeader(0)).code(204).send();
    });
  }
}
