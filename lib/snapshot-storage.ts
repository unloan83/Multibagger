/**
 * Vercel-compatible snapshot persistence layer.
 *
 * Write priority:
 *   1. Vercel Blob  (BLOB_READ_WRITE_TOKEN present — durable, cross-invocation)
 *   2. /tmp         (Vercel without Blob — ephemeral per warm instance, never EROFS)
 *   3. data/        (local dev only — process.cwd() is writable on your machine)
 *
 * Read priority:
 *   1. Vercel Blob  (freshest data, written by cron)
 *   2. /tmp         (same warm invocation write)
 *   3. data/        (committed seed files — readable even on Vercel /var/task)
 */
import fs from "node:fs/promises";
import path from "node:path";

const BLOB_FOLDER = "snapshots";

// Evaluated once at module load (cold-start).
const IS_VERCEL = Boolean(process.env.VERCEL);
const HAS_BLOB_TOKEN = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

// Module-level URL cache so warm Lambda instances avoid a list() round-trip.
const blobUrlCache = new Map<string, string>();

// ---------------------------------------------------------------------------
// Public diagnostic (used by /api/storage/status)
// ---------------------------------------------------------------------------

export function getSnapshotStorageStatus() {
  return {
    isVercel: IS_VERCEL,
    hasBlobToken: HAS_BLOB_TOKEN,
    writeTarget: HAS_BLOB_TOKEN
      ? "vercel-blob"
      : IS_VERCEL
        ? "/tmp (ephemeral — connect a Blob Store for durable storage)"
        : "local data/",
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function writeSnapshotFile(
  filename: string,
  content: string,
): Promise<void> {
  // ── Path 1: Vercel Blob Storage ──────────────────────────────────────────
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

  // ── Path 2: /tmp (Vercel without Blob) ───────────────────────────────────
  // /var/task (process.cwd()) is read-only on Vercel — never touch it.
  // /tmp is always writable on Lambda runtimes.
  if (IS_VERCEL) {
    console.warn(
      `[snapshot-storage] BLOB_READ_WRITE_TOKEN not set — writing "${filename}" ` +
        `to /tmp (ephemeral). Connect a Vercel Blob Store for durable snapshots.`,
    );
    await fs.writeFile(path.join("/tmp", filename), content, "utf8");
    return;
  }

  // ── Path 3: Local data/ directory ────────────────────────────────────────
  const dataPath = path.join(process.cwd(), "data", filename);
  await fs.mkdir(path.dirname(dataPath), { recursive: true });
  await fs.writeFile(dataPath, content, "utf8");
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function readSnapshotFile(filename: string): Promise<string | null> {
  // 1. Blob Storage
  if (HAS_BLOB_TOKEN) {
    const blobContent = await readFromBlob(filename);
    if (blobContent !== null) return blobContent;
  }

  // 2. /tmp (written by this warm invocation when Blob is absent)
  const tmpContent = await tryRead(path.join("/tmp", filename));
  if (tmpContent !== null) return tmpContent;

  // 3. Committed seed file in data/ (readable even on /var/task)
  return tryRead(path.join(process.cwd(), "data", filename));
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
      const blob = blobs.find(
        (b) => b.pathname === `${BLOB_FOLDER}/${filename}`,
      );
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

async function tryRead(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}
