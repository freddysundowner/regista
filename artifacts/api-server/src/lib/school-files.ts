import { Storage } from "@google-cloud/storage";
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
export function storedObject(key: string) {
  const parts = (process.env.PRIVATE_OBJECT_DIR ?? "").replace(/^\/+/, "").split("/");
  const bucket = parts.shift();
  if (!bucket) throw new ApiError(503, "File storage is not configured");
  return storageClient.bucket(bucket).file([...parts, key].join("/"));
}
export async function uploadUrl(key: string) {
  const file = storedObject(key);
  const response = await fetch("http://127.0.0.1:1106/object-storage/signed-object-url", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket_name: file.bucket.name, object_name: file.name, method: "PUT", expires_at: new Date(Date.now() + 600000).toISOString() }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new ApiError(503, "Unable to authorize file upload");
  return (await response.json() as { signed_url: string }).signed_url;
}
export function validImage(bytes: Buffer, contentType: string) {
  if (contentType === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (contentType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (contentType === "image/webp") return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  return false;
}