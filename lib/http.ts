import { z, ZodError } from 'zod';
import { ServiceError } from '@/lib/engine/service';

export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

export function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export const uuidSchema = z.string().uuid();

/** Wraps a route handler so every failure becomes a clean JSON error. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ServiceError) return errorResponse(err.status, err.code, err.message);
    if (err instanceof ZodError) {
      const detail = err.issues
        .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
        .join('; ');
      return errorResponse(400, 'invalid_request', detail);
    }
    console.error(
      'Unhandled route error',
      err instanceof Error ? `${err.name}: ${err.message}` : 'unknown',
    );
    return errorResponse(500, 'internal_error', 'Something went wrong');
  }
}

/** Parses a JSON body, treating an empty or malformed body as an empty object. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function parseSessionId(id: string): string {
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) throw new ServiceError(404, 'session_not_found', 'Session not found');
  return parsed.data;
}
