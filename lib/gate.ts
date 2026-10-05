/** Shared by the proxy (Edge runtime) and the gate route: both use Web Crypto only. */
export const GATE_COOKIE = 'demo_auth';

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** What the cookie must contain. It never reveals the password itself. */
export async function gateToken(password: string, secret: string): Promise<string> {
  return sha256Hex(`${password}:${secret}`);
}

/** Constant-time-ish comparison of two hex strings. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Only allow redirects back into this site. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
