export interface UploadedFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  hasText?: boolean;
}

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp|avif)$/;
export const FILE_ACCEPT =
  "application/pdf,image/png,image/jpeg,image/gif,image/webp,image/avif,text/plain,text/markdown,text/csv";

export const attachmentUrl = (id: string) => `/api/kx/attachments/${id}`;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Upload a file as an attachment of `docId`. Throws with a user-facing message. */
export async function uploadFile(
  docId: string,
  file: File,
): Promise<UploadedFile> {
  if (file.size > MAX_UPLOAD_BYTES)
    throw new Error(`${file.name} is larger than 20 MB`);
  const type = file.type || (file.name.endsWith(".md") ? "text/markdown" : "");
  const res = await fetch(
    `/api/kx/attachments?docId=${encodeURIComponent(docId)}&name=${encodeURIComponent(file.name)}`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": type },
      body: file,
    },
  );
  const json = (await res.json().catch(() => ({}))) as {
    data?: UploadedFile;
    message?: string;
  };
  if (!res.ok || !json.data)
    throw new Error(json.message ?? `Upload failed (${res.status})`);
  return json.data;
}
