/**
 * Vercel-compatible snapshot persistence layer.
 *
 * Write priority:
 *   1. Vercel Blob  — when BLOB_READ_WRITE_TOKEN is set (cross-invocation persistence).
 *   2. data/        — local dev (process.cwd() is writable on your machine).
 *   3. /tmp         — Vercel fallback when Blob is not yet configured.
 *                     /tmp is writable on every Lambda runtime and silently
 *                     avoids the EROFS crash. Data persists only for the warm
 *                     lifetime of a single function instance; configure Blob
 *                     for durable cross-invocation storage.
 *
 * Read priority:
 *   1. Vercel Blob  — freshest data, written by the most recent cron run.
 *   2. /tmp         — same warm-instance write done by this invocation.
 *   3. data/        — committed seed files (readable even on Vercel /var/task).
 */
import fs from "node:fs/promises";
import path from "node:path";

const BLOB_FOLDER = "snapshots";
const HAS_BLOB_TOKEN = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const IS_VERCEL = Boolean(process.env.VERCEL);

// Module-level URL cache — warm Lambda instances avoid a list() round-trip.
const blobUrlCache = new Map<string, string>();

// ---------------------------------------------------------------------------
// Public diagnostic helper (used by /api/storage/status)
// ---------------------------------------------------------------------------

export function getSnapshotStorageStatus() {
  return {
    isVercel: IS_VERCEL,
    hasBlobToken: HAS_BLOB_TOKEN,
    writeTarget: HAS_BLOB_TOKEN
      ? "vercel-blob"
      : IS_VERCEL
        ? "/tmp (configure Blob Store for durable storage)"
        : "local-fs (data/)",
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function writeSnapshotFile(
  filename: string,
  content: string,
): Promise<void> {
  // 1. Blob Storage — preferred durable path on Vercel.
  if (HAS_BLOB_TOKEN) {
    const { put } = await import("@vercel/blob");
    const blob = await put(`${BLOB_FOLDER}/${filename}`, content, {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json",
    });
    blobUrlCache.set(filename, blob.url);
    return;
  }

  // 2. Try data/ (works locally; EROFS on Vercel /var/task → caught below).
  const dataPath = path.join(process.cwd(), "data", filename);
  try {
    await fs.mkdir(path.dirname(dataPath), { recursive: true });
    await fs.writeFile(dataPath, content, "utf8");
    return;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EROFS" && code !== "EACCES" && code !== "EROFS") {
      throw err; // unexpected error — re-throw
    }
    // Filesystem is read-only (Vercel /var/task) — fall through to /tmp.
  }

  // 3. /tmp — writable on every Lambda runtime; survives within a warm
  //    instance but is NOT durable across cold starts.  Connect a Vercel
  //    Blob Store for durable storage.
  if (IS_VERCEL) {
    console.warn(
      `[snapshot-storage] BLOB_READ_WRITE_TOKEN is not set. ` +
      `Writing "${filename}" to /tmp (ephemeral). ` +
      `Connect a Vercel Blob Store and redeploy for durable snapshots.`,
    );
  }
  await fs.writeFile(path.join("/tmp", filename), content, "utf8");
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function readSnapshotFile(filename: string): Promise<string | null> {
  // 1. Blob Storage — freshest data.
  if (HAS_BLOB_TOKEN) {
    const blobContent = await readFromBlob(filename);
    if (blobContent !== null) return blobContent;
  }

  // 2. /tmp — written by this warm invocation when Blob isn't configured.
  const tmpContent = await readFromPath(path.join("/tmp", filename));
  if (tmpContent !== null) return tmpContent;

  // 3. Committed seed file in data/ (readable on Vercel /var/task).
  return readFromPath(path.join(process.cwd(), "data", filename));
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

async function readFromPath(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}
