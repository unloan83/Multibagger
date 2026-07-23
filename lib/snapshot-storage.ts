/**
 * Vercel-compatible snapshot persistence layer.
 *
 * Problem: Vercel serverless functions run inside a read-only filesystem
 * (/var/task). fs.writeFile() throws EROFS, so snapshot JSON files cannot
 * be written there after deployment.
 *
 * Solution: Route all snapshot writes through Vercel Blob Storage when
 * BLOB_READ_WRITE_TOKEN is present.  For reads, try Blob first (latest
 * cron-written data) and fall back to the committed data/ seed files
 * (safe default until the first cron run completes).
 *
 * Setup (one-time, in Vercel dashboard):
 *   Project → Storage → Create Blob Store → Connect to project
 *   Vercel auto-injects BLOB_READ_WRITE_TOKEN into all environments.
 *
 * Local development: when BLOB_READ_WRITE_TOKEN is absent the module
 * falls back to ordinary fs.readFile / fs.writeFile on the data/ directory.
 */
import fs from "node:fs/promises";
import path from "node:path";

const BLOB_FOLDER = "snapshots";

/**
 * Whether to use Vercel Blob Storage.
 * True when BLOB_READ_WRITE_TOKEN is set (Vercel deployment or local with token).
 * False when running locally without a Blob store.
 */
function useBlobStorage(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Module-level URL cache so warm Lambda instances avoid a list() call on
 * every agent read.  Keyed by filename (e.g. "wealth_recommendations.json").
 */
const blobUrlCache = new Map<string, string>();

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Writes a snapshot JSON string to Blob Storage (on Vercel) or the local
 * data/ directory.
 */
export async function writeSnapshotFile(
  filename: string,
  content: string,
): Promise<void> {
  if (useBlobStorage()) {
    const { put } = await import("@vercel/blob");
    const blob = await put(`${BLOB_FOLDER}/${filename}`, content, {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json",
    });
    // Cache the blob URL so subsequent reads skip the list() round-trip
    blobUrlCache.set(filename, blob.url);
    return;
  }

  // Local development: write directly to data/
  const filePath = path.join(process.cwd(), "data", filename);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Reads a snapshot JSON string.
 *
 * Priority:
 *   1. Vercel Blob (freshest data, written by the most recent cron run).
 *   2. Local data/ directory (committed seed file — readable on Vercel too
 *      since /var/task is read-only, not inaccessible).
 *
 * Returns null when neither source has the file.
 */
export async function readSnapshotFile(filename: string): Promise<string | null> {
  if (useBlobStorage()) {
    const blobContent = await readFromBlob(filename);
    if (blobContent !== null) return blobContent;
    // Fall back to the committed seed file for the initial read before the
    // first cron run has written to Blob
  }

  return readFromLocalFs(filename);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readFromBlob(filename: string): Promise<string | null> {
  try {
    // Use cached URL when available (avoids list() on warm Lambda instances)
    let url = blobUrlCache.get(filename);

    if (!url) {
      const { list } = await import("@vercel/blob");
      const { blobs } = await list({ prefix: `${BLOB_FOLDER}/${filename}` });
      const blob = blobs.find((b) => b.pathname === `${BLOB_FOLDER}/${filename}`);
      if (!blob) return null;
      url = blob.url;
      blobUrlCache.set(filename, url);
    }

    const res = await fetch(url, { cache: "no-store" } as RequestInit);
    if (!res.ok) {
      blobUrlCache.delete(filename); // invalidate stale cached URL on error
      return null;
    }
    return await res.text();
  } catch {
    return null;
  }
}

async function readFromLocalFs(filename: string): Promise<string | null> {
  try {
    return await fs.readFile(
      path.join(process.cwd(), "data", filename),
      "utf8",
    );
  } catch {
    return null;
  }
}
