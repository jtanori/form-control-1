import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export interface SessionPayload {
  sub: string;
  iat: number;
  exp: number;
  jti: string;
}

export class SessionError extends Error {
  readonly code: 'INVALID_TOKEN' | 'EXPIRED_TOKEN';

  constructor(code: 'INVALID_TOKEN' | 'EXPIRED_TOKEN') {
    super(code === 'EXPIRED_TOKEN' ? 'Session token has expired' : 'Session token is invalid');
    this.name = 'SessionError';
    this.code = code;
  }
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function issueSession(
  extensionId: string,
  secret: string,
  { ttlMs = SESSION_TTL_MS, now = Date.now() }: { ttlMs?: number; now?: number } = {},
): { token: string; expiresAt: number } {
  const iat = now;
  const exp = now + ttlMs;
  const payload: SessionPayload = { sub: extensionId, iat, exp, jti: randomUUID() };
  const encoded = b64url(JSON.stringify(payload));
  return { token: `${encoded}.${sign(encoded, secret)}`, expiresAt: exp };
}

export function verifySession(token: string, secret: string, now = Date.now()): SessionPayload {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) throw new SessionError('INVALID_TOKEN');
  const expected = sign(encoded, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new SessionError('INVALID_TOKEN');
  }
  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
  } catch {
    throw new SessionError('INVALID_TOKEN');
  }
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.exp !== 'number' ||
    typeof payload.iat !== 'number'
  ) {
    throw new SessionError('INVALID_TOKEN');
  }
  if (payload.exp <= now) throw new SessionError('EXPIRED_TOKEN');
  return payload;
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}
