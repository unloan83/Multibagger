/**
 * Vercel-compatible snapshot persistence layer.
 *
 * Write paths:
 *   1. Vercel Blob (when BLOB_READ_WRITE_TOKEN is present — always true on Vercel
 *      once the Blob Store is connected and the project has been redeployed).
 *   2. Local filesystem data/ directory (local dev only, never on Vercel).
 *
 * The module NEVER falls through to fs.writeFile() on Vercel.  If
 * BLOB_READ_WRITE_TOKEN is absent inside a Vercel deployment the write throws
 * immediately with a clear error rather than hitting EROFS on /var/task.
 *
 * Read paths:
 *   1. Vercel Blob  (freshest data, written by the cron).
 *   2. Local data/  (committed seed files — safe readable fallback on Vercel
 *      because /var/task is read-only but NOT inaccessible).
 */
import fs from "node:fs/promises";
import path from "node:path";

const BLOB_FOLDER = "snapshots";

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

/** True when running inside a Vercel serverless function. */
const IS_VERCEL = Boolean(process.env.VERCEL);

/** True when the Vercel Blob Store is wired up (token auto-injected by Vercel). */
const HAS_BLOB_TOKEN = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

// ---------------------------------------------------------------------------
// Module-level URL cache — warm Lambda instances skip a list() round-trip.
// ---------------------------------------------------------------------------
const blobUrlCache = new Map<string, string>();

// ---------------------------------------------------------------------------
// Public diagnostic helper
// ---------------------------------------------------------------------------

/** Returns a plain-object snapshot of the storage configuration.  Used by
 *  /api/storage/status so operators can inspect the live runtime state. */
export function getSnapshotStorageStatus() {
  return {
    isVercel: IS_VERCEL,
    hasBlobToken: HAS_BLOB_TOKEN,
    blobFolder: BLOB_FOLDER,
    writeTarget: IS_VERCEL
      ? HAS_BLOB_TOKEN
        ? "vercel-blob"
        : "none — BLOB_READ_WRITE_TOKEN missing, writes will fail"
      : "local-fs",
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Persists a snapshot JSON string.
 *
 * On Vercel: writes to Blob Storage only.  Throws if BLOB_READ_WRITE_TOKEN is
 * absent so the error surfaces clearly instead of crashing with EROFS.
 *
 * Locally: writes to the data/ directory (creates it if needed).
 */
export async function writeSnapshotFile(
  filename: string,
  content: string,
): Promise<void> {
  if (IS_VERCEL) {
    if (!HAS_BLOB_TOKEN) {
      throw new Error(
        `[snapshot-storage] Cannot write "${filename}" on Vercel: ` +
        "BLOB_READ_WRITE_TOKEN is not set. " +
        "Go to the Vercel dashboard → Storage → connect a Blob Store to this project, " +
        "then redeploy so the token is injected into the serverless functions.",
      );
    }

    const { put } = await import("@vercel/blob");
    const blob = await put(`${BLOB_FOLDER}/${filename}`, content, {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json",
    });
    blobUrlCache.set(filename, blob.url);
    return;
  }

  // Local development — write to data/
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
 *   1. Vercel Blob (freshest — written by the most recent cron run).
 *   2. Local data/ directory (committed seed file; readable even on Vercel).
 *
 * Returns null when neither source has the file.
 */
export async function readSnapshotFile(filename: string): Promise<string | null> {
  if (HAS_BLOB_TOKEN) {
    const blobContent = await readFromBlob(filename);
    if (blobContent !== null) return blobContent;
    // Fall back to the committed seed file for the initial read before the
    // first cron run has written to Blob.
  }

  return readFromLocalFs(filename);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readFromBlob(filename: string): Promise<string | null> {
  try {
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
      blobUrlCache.delete(filename);
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
