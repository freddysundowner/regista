import { useEffect, useRef, useState } from "react";
import { useGetStoredFile, getGetStoredFileQueryKey, useRequestFileUpload, useCompleteFileUpload, FileUploadInputContentType, type FileUploadInputPurpose } from "@workspace/api-client-react";
import { ImageUp, Loader2 } from "lucide-react";
import { Btn } from "@/components/kit";
import { errMsg } from "@/lib/session";
import { cn } from "@/lib/utils";

const MAX = 5 * 1024 * 1024;
const TYPES = Object.values(FileUploadInputContentType) as string[];

/** Extracts the file id from an authenticated reference like /api/storage/files/<uuid>. */
export function fileIdFromRef(ref?: string | null) {
  const m = ref?.match(/^\/api\/storage\/files\/([0-9a-fA-F-]{36})$/);
  return m ? m[1] : null;
}

export function StoredImage({ refPath, alt, className, fallback }: { refPath?: string | null; alt: string; className?: string; fallback: React.ReactNode }) {
  const id = fileIdFromRef(refPath);
  const q = useGetStoredFile(id ?? "", { query: { queryKey: getGetStoredFileQueryKey(id ?? ""), enabled: !!id, staleTime: 5 * 60_000, retry: false } });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!(q.data instanceof Blob)) { setUrl(null); return; }
    const u = URL.createObjectURL(q.data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [q.data]);
  if (!id || q.isError || (!q.isLoading && !url)) return <>{fallback}</>;
  if (!url) return <div className={cn("animate-pulse bg-muted", className)} aria-label={`Loading ${alt}`} />;
  return <img src={url} alt={alt} className={cn("object-cover", className)} />;
}

/**
 * Upload flow: requestFileUpload -> PUT bytes to signed URL -> completeFileUpload -> onSaved(objectPath).
 * onSaved must PATCH the owning record with the returned reference.
 */
export function ImageUploadButton({ purpose, entityId, label, onSaved, testid, hideButton }: {
  purpose: FileUploadInputPurpose; entityId: string; label: string; testid: string;
  /** Keep only the file input (opened from elsewhere, e.g. a menu) and its messages. */
  hideButton?: boolean;
  onSaved: (objectPath: string) => Promise<unknown>;
}) {
  const req = useRequestFileUpload();
  const done = useCompleteFileUpload();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handle = async (file: File) => {
    setErr(null);
    if (!TYPES.includes(file.type)) return setErr("Use a JPEG, PNG or WebP image.");
    if (file.size > MAX) return setErr("Image must be 5 MB or smaller.");
    setBusy(true);
    try {
      const up = await req.mutateAsync({ data: { name: file.name.slice(0, 180), size: file.size, contentType: file.type as FileUploadInputContentType, purpose, entityId } });
      const put = await fetch(up.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error("The image upload did not complete. Try again.");
      const ref = await done.mutateAsync({ fileId: up.id });
      await onSaved(ref.objectPath);
    } catch (x) {
      setErr(errMsg(x, "Upload failed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <input ref={input} type="file" accept={TYPES.join(",")} className="sr-only" aria-label={label} data-testid={`input-${testid}`}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handle(f); }} />
      {hideButton ? busy && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Uploading photo</span> : (
        <Btn type="button" variant="outline" className="h-8" disabled={busy} data-testid={`button-${testid}`} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageUp className="h-3.5 w-3.5" />}{busy ? "Uploading" : label}
        </Btn>
      )}
      {err && <span role="alert" data-testid={`text-${testid}-error`} className="max-w-56 text-[11px] text-destructive">{err}</span>}
    </div>
  );
}
