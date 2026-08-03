/** Durable snapshot storage for Vercel, with local filesystem fallbacks. */
import fs from "node:fs/promises";
import path from "node:path";

const BLOB_FOLDER = "snapshots";
const dataDir = path.join(process.cwd(), "data");

function hasBlobStorage(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID),
  );
}

export async function readSnapshotFile(filename: string): Promise<string | null> {
  if (hasBlobStorage()) {
    try {
      const { get } = await import("@vercel/blob");
      const result = await get(`${BLOB_FOLDER}/${filename}`, {
        access: "private",
        useCache: false,
      });
      if (result?.stream) {
        return await new Response(result.stream).text();
      }
    } catch {
      // Fall back to a seed file if Blob is temporarily unavailable.
    }
  }

  for (const filePath of [path.join("/tmp", filename), path.join(dataDir, filename)]) {
    try {
      return await fs.readFile(filePath, "utf8");
    } catch {
      // Try the next storage location.
    }
  }
  return null;
}

export async function writeSnapshotFile(filename: string, content: string): Promise<void> {
  if (hasBlobStorage()) {
    const { put } = await import("@vercel/blob");
    await put(`${BLOB_FOLDER}/${filename}`, content, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60,
    });
    return;
  }

  if (process.env.VERCEL) {
    throw new Error(
      "Durable storage is not configured. Connect a Vercel Blob store to this project.",
    );
  }

  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, filename), content, "utf8");
}
