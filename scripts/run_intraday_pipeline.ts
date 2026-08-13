import { readPaperSignals } from "../lib/intraday-engine";

async function main() {
  const snapshot = await readPaperSignals();
  console.log(JSON.stringify(snapshot, null, 2));
  if (snapshot.status === "NO_TRADE") console.log("NO_TRADE");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
