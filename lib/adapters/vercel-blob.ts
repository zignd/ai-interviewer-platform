import { del } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import type { BlobStore } from '@/lib/ports';

/** Vercel Blob: `del` is free, and client tokens are capped to the declared file size. */
export class VercelBlobStore implements BlobStore {
  constructor(private readonly token: string) {}

  async delete(urls: string[]) {
    if (urls.length === 0) return;
    await del(urls, { token: this.token });
  }

  async createUploadToken(pathname: string, maxBytes: number) {
    return generateClientTokenFromReadWriteToken({
      token: this.token,
      pathname,
      maximumSizeInBytes: maxBytes,
      validUntil: Date.now() + 15 * 60 * 1000,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  }
}
