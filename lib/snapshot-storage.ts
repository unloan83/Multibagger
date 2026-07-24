/**
 * Vercel-compatible snapshot persistence layer.
 *
 * Write strategy (no Blob token):
 *   1. Write to /tmp FIRST — always writable on every runtime (Vercel Lambda,
 *      Linux, macOS). This can never throw EROFS.
 *   2. Also attempt data/ for local dev persistence — errors are silently
 *      swallowed (Vercel /var/task is read-only but /tmp already succeeded).
 *
 * Write strategy (Blob token present):
 *   → Vercel Blob Storage only (durable, cross-invocation).
 *
 * Read priority:
 *   1. Vercel Blob (freshest, if token present)
 *   2. /tmp        (written above, same or warm instance)
 *   3. data/       (committed seed files, readable on /var/task)
 */
import fs from "node:fs/promises";
import path from "node:path";

const BLOB_FOLDER = "snapshots";
const HAS_BLOB_TOKEN = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

// Module-level URL cache so warm Lambda instances avoid a list() round-trip.
const blobUrlCache = new Map<string, string>();

// ---------------------------------------------------------------------------
// Public diagnostic (used by /api/storage/status)
// ---------------------------------------------------------------------------

export function getSnapshotStorageStatus() {
  return {
    hasBlobToken: HAS_BLOB_TOKEN,
    isVercel: Boolean(process.env.VERCEL),
    writeTarget: HAS_BLOB_TOKEN ? "vercel-blob" : "/tmp (+ data/ attempt)",
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function writeSnapshotFile(
  filename: string,
  content: string,
): Promise<void> {
  // ── Blob Storage (preferred for Vercel — durable across invocations) ─────
  if (HAS_BLOB_TOKEN) {
    const { put } = await import("@vercel/blob");
    await put(`${BLOB_FOLDER}/${filename}`, content, {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json",
    });
    // Don't cache private blob URLs — they are pre-signed and expire.
    blobUrlCache.delete(filename);
    return;
  }

  // ── /tmp (primary non-Blob path) ─────────────────────────────────────────
  // /tmp is writable on every Lambda runtime AND locally. Writing here first
  // guarantees we never hit EROFS regardless of environment detection.
  await fs.writeFile(path.join("/tmp", filename), content, "utf8");

  // ── data/ (local dev secondary — fire and forget) ─────────────────────────
  // On Vercel /var/task this will EROFS — that error is intentionally ignored
  // because /tmp already succeeded above.
  const dataPath = path.join(process.cwd(), "data", filename);
  try {
    await fs.mkdir(path.dirname(dataPath), { recursive: true });
    await fs.writeFile(dataPath, content, "utf8");
  } catch {
    // Read-only filesystem (Vercel) or permission error — /tmp write succeeded.
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function readSnapshotFile(filename: string): Promise<string | null> {
  // 1. Blob Storage — freshest data
  if (HAS_BLOB_TOKEN) {
    const blobContent = await readFromBlob(filename);
    if (blobContent !== null) return blobContent;
  }

  // 2. /tmp — written by this or a recent warm invocation
  const tmpContent = await tryRead(path.join("/tmp", filename));
  if (tmpContent !== null) return tmpContent;

  // 3. Committed seed file in data/ (readable on Vercel /var/task)
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
