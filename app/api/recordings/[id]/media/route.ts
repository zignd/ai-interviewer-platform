import { get } from '@vercel/blob';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { recordings } from '@/lib/db/schema';
import { errorResponse, handle, parseSessionId } from '@/lib/http';

export const maxDuration = 60;

/** Parses a single `Range: bytes=start-end` header. Returns null when absent or unsupported. */
export function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    // Suffix range: the last N bytes.
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

/**
 * Streams a stored recording to the browser. The Blob store is private, so the bytes go through this route.
 * Recordings are small (about 40 MB at most), so the file is read once and sliced to honour Range requests,
 * which is what lets the video player seek.
 */
export async function GET(request: Request, ctx: RouteContext<'/api/recordings/[id]/media'>) {
  return handle(async () => {
    const { id } = await ctx.params;
    const recordingId = parseSessionId(id);
    const row = (
      await getDb().select().from(recordings).where(eq(recordings.id, recordingId)).limit(1)
    )[0];
    if (!row || row.status !== 'stored' || !row.blobUrl) {
      return errorResponse(404, 'recording_unavailable', 'Recording unavailable');
    }
    let blob;
    try {
      blob = await get(row.blobUrl, {
        access: 'private',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
    } catch {
      return errorResponse(404, 'recording_unavailable', 'Recording unavailable');
    }
    if (!blob || blob.statusCode !== 200)
      return errorResponse(404, 'recording_unavailable', 'Recording unavailable');

    const bytes = new Uint8Array(await new Response(blob.stream).arrayBuffer());
    const contentType =
      blob.blob.contentType || (row.kind === 'video' ? 'video/webm' : 'audio/webm');
    const headers = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=300',
    };
    const range = parseRange(request.headers.get('range'), bytes.length);
    if (range) {
      const slice = bytes.slice(range.start, range.end + 1);
      return new Response(slice, {
        status: 206,
        headers: {
          ...headers,
          'Content-Range': `bytes ${range.start}-${range.end}/${bytes.length}`,
          'Content-Length': String(slice.length),
        },
      });
    }
    return new Response(bytes, { headers: { ...headers, 'Content-Length': String(bytes.length) } });
  });
}
