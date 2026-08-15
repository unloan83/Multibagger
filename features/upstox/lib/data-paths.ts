import fs from "node:fs";
import path from "node:path";

export function upstoxDataPath(filename: string): string {
  const featurePath = path.join(process.cwd(), "features", "upstox", "data", filename);
  if (!process.env.VERCEL) return featurePath;

  const writablePath = path.join("/tmp", "upstox", filename);
  if (!fs.existsSync(writablePath)) {
    const legacyPath = path.join(process.cwd(), "data", filename);
    const seedPath = fs.existsSync(featurePath) ? featurePath : legacyPath;
    fs.mkdirSync(path.dirname(writablePath), { recursive: true });
    if (fs.existsSync(seedPath)) fs.copyFileSync(seedPath, writablePath);
  }
  return writablePath;
}
