/**
 * How long a download's object URL stays alive. iOS Safari can read the blob
 * well after the click returns, so revoking on the next tick can cancel it.
 */
export const BLOB_URL_REVOKE_MS = 60_000;

/** Hand a Blob to the browser as a file download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_REVOKE_MS);
}
