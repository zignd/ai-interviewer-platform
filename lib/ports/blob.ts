/** Object storage for session recordings. */
export interface BlobStore {
  /** Deletes blobs by URL. Missing blobs are not an error. */
  delete(urls: string[]): Promise<void>;
  /** A short-lived client token that lets the browser upload one file of at most `maxBytes` to `pathname`. */
  createUploadToken(pathname: string, maxBytes: number): Promise<string>;
}
