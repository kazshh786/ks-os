import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const encode = (value: Buffer | string) => Buffer.from(value).toString('base64url');

export function createFactFindingToken() {
  return randomBytes(32).toString('base64url');
}

export function digestFactFindingToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function deriveFactFindingInvitationToken(input: {
  invitationReference: string;
  questionnaireReference: string;
  participantReference: string;
  secret: string;
}) {
  const payload = encode(JSON.stringify({
    v: 1,
    i: input.invitationReference,
    q: input.questionnaireReference,
    p: input.participantReference,
  }));
  const signature = createHmac('sha256', input.secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyFactFindingInvitationToken(token: string, secret: string) {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (value.v !== 1 || typeof value.i !== 'string' || typeof value.q !== 'string' || typeof value.p !== 'string') return null;
    return { invitationReference: value.i, questionnaireReference: value.q, participantReference: value.p };
  } catch { return null; }
}
