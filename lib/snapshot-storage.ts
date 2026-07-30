/**
 * Simplified snapshot storage — reads/writes directly to disk.
 * Removes the Vercel Blob / Google Sheets overhead.
 */
import fs from "node:fs/promises";
import path from "node:path";

const dataDir = path.join(process.cwd(), "data");

export async function readSnapshotFile(filename: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(dataDir, filename), "utf8");
  } catch {
    return null;
  }
}

export async function writeSnapshotFile(filename: string, content: string): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, filename), content, "utf8");
}
