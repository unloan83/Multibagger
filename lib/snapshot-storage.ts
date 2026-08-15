/** Durable snapshot storage for Vercel, with local filesystem fallbacks. */
import fs from "node:fs/promises";
import path from "node:path";

const BLOB_FOLDER = "snapshots";
const dataDir = path.join(process.cwd(), "data");

function localSnapshotPath(filename: string): string {
  const [feature, ...rest] = filename.split("/");
  if ((feature === "breeze" || feature === "upstox" || feature === "options-quant") && rest.length > 0) {
    return path.join(process.cwd(), "features", feature, "data", ...rest);
  }
  return path.join(dataDir, filename);
}

function legacyFilename(filename: string): string | null {
  const [feature, ...rest] = filename.split("/");
  return (feature === "breeze" || feature === "upstox") && rest.length > 0 ? rest.join("/") : null;
}

function hasBlobStorage(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.VERCEL_OIDC_TOKEN && process.env.BLOB_STORE_ID),
  );
}

export async function readSnapshotFile(filename: string): Promise<string | null> {
  const candidates: string[] = [];

  if (hasBlobStorage()) {
    const { get } = await import("@vercel/blob");
    for (const blobName of [filename, legacyFilename(filename)].filter((value): value is string => Boolean(value))) {
      try {
        const result = await get(`${BLOB_FOLDER}/${blobName}`, {
          access: "private",
          useCache: false,
        });
        if (result?.stream) {
          candidates.push(await new Response(result.stream).text());
        }
      } catch {
        // Try the next feature or legacy storage location.
      }
    }
  }

  const legacy = legacyFilename(filename);
  const localCandidates = [path.join("/tmp", filename), localSnapshotPath(filename)];
  if (legacy) localCandidates.push(path.join("/tmp", legacy), path.join(dataDir, legacy));
  for (const filePath of localCandidates) {
    try {
      candidates.push(await fs.readFile(filePath, "utf8"));
    } catch {
      // Try the next storage location.
    }
  }

  if (candidates.length === 0) return null;

  // Blob remains authoritative for untimestamped state such as watchlist.json.
  // For model snapshots, guard against an old Blob object masking a newer seed
  // deployed with the application.
  return candidates.reduce((newest, candidate) =>
    getSnapshotTimestamp(candidate) > getSnapshotTimestamp(newest) ? candidate : newest,
  );
}

function getSnapshotTimestamp(content: string): number {
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    for (const key of ["asOf", "generatedAt", "updatedAt"]) {
      if (typeof value[key] === "string") {
        const timestamp = Date.parse(value[key]);
        if (Number.isFinite(timestamp)) return timestamp;
      }
    }
  } catch {
    // Untimestamped or non-JSON content keeps storage priority order.
  }
  return Number.NEGATIVE_INFINITY;
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

  const destination = localSnapshotPath(filename);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, content, "utf8");
}
