import initSqlJs from "sql.js";
import fs from "node:fs";

function randomVector(dimension, seed) {
  const out = new Float32Array(dimension);
  let value = seed | 0;
  for (let i = 0; i < dimension; i += 1) {
    value = (value * 1664525 + 1013904223) | 0;
    out[i] = ((value >>> 0) % 1000) / 1000;
  }
  return out;
}

function l2Normalize(vector) {
  let sum = 0;
  for (let i = 0; i < vector.length; i += 1) {
    sum += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm <= 0) {
    return vector;
  }
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) {
    out[i] = vector[i] / norm;
  }
  return out;
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function runScenario(vectors, dimension) {
  const query = l2Normalize(randomVector(dimension, 7));
  const start = performance.now();
  let best = -1;
  let bestIndex = -1;
  for (let i = 0; i < vectors.length; i += 1) {
    const score = cosine(query, vectors[i]);
    if (score > best) {
      best = score;
      bestIndex = i;
    }
  }
  const ms = performance.now() - start;
  return { best, bestIndex, ms };
}

async function main() {
  const SQL = await initSqlJs({
    locateFile: (file) => `node_modules/sql.js/dist/${file}`,
  });
  const db = new SQL.Database();
  db.run("CREATE TABLE IF NOT EXISTS bench (id INTEGER PRIMARY KEY, dim INTEGER NOT NULL, blob BLOB NOT NULL);");

  const vectorsCount = Number(process.env.BENCH_VECTORS ?? 10000);
  const dims = [384, 768];
  const report = [];
  for (const dim of dims) {
    const vectors = [];
    for (let i = 0; i < vectorsCount; i += 1) {
      const vector = l2Normalize(randomVector(dim, i + 11));
      vectors.push(vector);
      db.run("INSERT INTO bench (dim, blob) VALUES (?, ?);", [
        dim,
        new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength),
      ]);
    }
    const result = runScenario(vectors, dim);
    report.push({
      vectors: vectorsCount,
      dimension: dim,
      queryMs: Number(result.ms.toFixed(3)),
      peakHeapMb: Number((process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2)),
    });
  }

  fs.writeFileSync("docs/embedding-benchmark-latest.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
