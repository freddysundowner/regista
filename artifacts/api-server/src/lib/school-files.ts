import { Storage, type File } from "@google-cloud/storage";
import { createReadStream, createWriteStream, mkdirSync, promises as fs } from "node:fs";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { ApiError } from "./core";

export const storageClient = new Storage({
  projectId: "",
  credentials: {
    audience: "replit", subject_token_type: "access_token",
    token_url: "http://127.0.0.1:1106/token", type: "external_account",
    credential_source: { url: "http://127.0.0.1:1106/credential", format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  },
});

/** The few object operations the app uses, the same whether files live in the cloud bucket or on this server's disk. */
export interface StoredObject {
  readonly name: string;
  save(data: Buffer | string, options?: { contentType?: string; resumable?: boolean; metadata?: Record<string, unknown> }): Promise<void>;
  download(range?: { start: number; end: number }): Promise<[Buffer]>;
  exists(): Promise<[boolean]>;
  getMetadata(): Promise<[{ size: number }]>;
  copy(destination: StoredObject): Promise<void>;
  setMetadata(metadata: { contentType?: string; cacheControl?: string }): Promise<void>;
  delete(options?: { ignoreNotFound?: boolean }): Promise<void>;
  createReadStream(): Readable;
  createWriteStream(options?: { resumable?: boolean; contentType?: string; metadata?: Record<string, unknown> }): Writable;
}

const bucketParts = () => (process.env.PRIVATE_OBJECT_DIR ?? "").replace(/^\/+/, "").split("/").filter(Boolean);
/** Cloud storage when PRIVATE_OBJECT_DIR names a bucket; otherwise files are kept in a folder on this server. */
export const usesLocalStorage = () => !bucketParts().length;
/** Where files are kept on this server: UPLOAD_DIR, or ./storage beside the API. */
export const localStorageRoot = () => path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), "storage"));
/** Documents can always be stored: in the cloud bucket, or on this server's disk. */
export const storageConfigured = () => true;

class CloudObject implements StoredObject {
  constructor(readonly file: File) {}
  get name() { return this.file.name; }
  get bucketName() { return this.file.bucket.name; }
  async save(data: Buffer | string, options?: Parameters<StoredObject["save"]>[1]) { await this.file.save(data, options); }
  async download(range?: { start: number; end: number }) { const [bytes] = await this.file.download(range ?? {}); return [bytes] as [Buffer]; }
  async exists() { return this.file.exists() as Promise<[boolean]>; }
  async getMetadata() { const [m] = await this.file.getMetadata(); return [{ size: Number(m.size) }] as [{ size: number }]; }
  async copy(destination: StoredObject) { await this.file.copy((destination as CloudObject).file); }
  async setMetadata(metadata: { contentType?: string; cacheControl?: string }) { await this.file.setMetadata(metadata); }
  async delete(options?: { ignoreNotFound?: boolean }) { await this.file.delete(options); }
  createReadStream() { return this.file.createReadStream(); }
  createWriteStream(options?: Parameters<StoredObject["createWriteStream"]>[0]) { return this.file.createWriteStream(options); }
}

/** A file under the server's storage folder. Keys never climb out of it. */
class LocalObject implements StoredObject {
  readonly path: string;
  constructor(readonly name: string) {
    const root = localStorageRoot();
    this.path = path.resolve(root, name);
    if (!this.path.startsWith(root + path.sep)) throw new ApiError(400, "Invalid file key");
  }
  async save(data: Buffer | string) {
    await fs.mkdir(path.dirname(this.path), { recursive: true });
    // Write beside the target, then rename, so a reader never sees half a file.
    const temp = `${this.path}.${process.pid}.${Date.now()}.part`;
    await fs.writeFile(temp, data, { mode: 0o600 });
    await fs.rename(temp, this.path);
  }
  async download(range?: { start: number; end: number }) {
    if (!range) return [await fs.readFile(this.path)] as [Buffer];
    const handle = await fs.open(this.path, "r");
    try {
      const buffer = Buffer.alloc(range.end - range.start + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, range.start);
      return [buffer.subarray(0, bytesRead)] as [Buffer];
    } finally { await handle.close(); }
  }
  async exists() { return [await fs.stat(this.path).then((s) => s.isFile(), () => false)] as [boolean]; }
  async getMetadata() { return [{ size: (await fs.stat(this.path)).size }] as [{ size: number }]; }
  async copy(destination: StoredObject) {
    const target = (destination as LocalObject).path;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(this.path, target);
  }
  async setMetadata() { /* Content type and caching are kept in the database record. */ }
  async delete(options?: { ignoreNotFound?: boolean }) {
    await fs.unlink(this.path).catch((err: NodeJS.ErrnoException) => { if (!(options?.ignoreNotFound && err.code === "ENOENT")) throw err; });
  }
  createReadStream() { return createReadStream(this.path); }
  createWriteStream() {
    // Streams (database backups) are large: create the folder first, then write straight to the file.
    mkdirSync(path.dirname(this.path), { recursive: true });
    return createWriteStream(this.path, { mode: 0o600 });
  }
}

export function storedObject(key: string): StoredObject {
  if (usesLocalStorage()) return new LocalObject(key);
  const [bucket, ...prefix] = bucketParts();
  return new CloudObject(storageClient.bucket(bucket).file([...prefix, key].join("/")));
}

async function signedCloudUrl(object: StoredObject, method: "GET" | "PUT", ttlMs: number) {
  const cloud = object as CloudObject;
  const response = await fetch("http://127.0.0.1:1106/object-storage/signed-object-url", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket_name: cloud.bucketName, object_name: cloud.name, method, expires_at: new Date(Date.now() + ttlMs).toISOString() }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new ApiError(503, method === "PUT" ? "Unable to authorize file upload" : "Private document signing unavailable");
  return (await response.json() as { signed_url: string }).signed_url;
}

/** Where the browser sends an upload's bytes: a short-lived bucket URL, or this API's own upload route when files stay on this server. */
export async function uploadUrl(key: string, localUploadPath: string) {
  return usesLocalStorage() ? localUploadPath : signedCloudUrl(storedObject(key), "PUT", 600000);
}

/** A link to read a private file: a 24-hour signed bucket URL, or the signed-in download route when files stay on this server. */
export async function readUrl(key: string, localDownloadPath: string) {
  const expiresAt = new Date(Date.now() + 86400000).toISOString();
  return { downloadUrl: usesLocalStorage() ? localDownloadPath : await signedCloudUrl(storedObject(key), "GET", 86400000), expiresAt };
}

export function validImage(bytes: Buffer, contentType: string) {
  if (contentType === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (contentType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (contentType === "image/webp") return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (contentType === "application/pdf") return bytes.toString("ascii", 0, 5) === "%PDF-";
  return false;
}
