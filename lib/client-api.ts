/** Small fetch helper for the browser. Throws an Error with the server's message. */
export async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
  return data as T;
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
  return data as T;
}
