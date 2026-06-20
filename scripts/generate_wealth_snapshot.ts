import {
  generateExpertActionMatrix,
  writeExpertActionMatrixSnapshot,
} from "../lib/expert-insights";

async function main() {
  const matrix = await generateExpertActionMatrix();
  await writeExpertActionMatrixSnapshot(matrix);

  const longTerm = matrix.categories.reduce(
    (sum, category) => sum + category.longTermUpsides.length,
    0,
  );
  const intraday = matrix.categories.reduce(
    (sum, category) => sum + category.intradayBreakouts.length,
    0,
  );

  console.log(
    JSON.stringify(
      {
        asOf: matrix.asOf,
        universeSize: matrix.universeSize,
        evaluatedSize: matrix.evaluatedSize,
        eligibleSize: matrix.eligibleSize,
        abstained: matrix.abstained,
        marketRegime: matrix.marketRegime,
        longTerm,
        intraday,
      },
      null,
      2,
    ),
  );
}

void main();
