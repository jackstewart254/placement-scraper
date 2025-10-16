import fs from "fs";

console.log("🚀 Node.js Performance Micro-Benchmark\n");
console.log(`Node.js version: ${process.version}`);
console.log(`Platform: ${process.platform} ${process.arch}\n`);

function timer(label, fn) {
  const start = performance.now();
  const result = fn();
  const end = performance.now();
  console.log(`${label}: ${(end - start).toFixed(2)} ms`);
  return result;
}

// 1️⃣ JSON Parsing Test
timer("JSON parse/stringify (100 000 objs)", () => {
  const objs = Array.from({ length: 100_000 }, (_, i) => ({
    id: i,
    x: Math.random(),
    y: Math.random(),
  }));
  const json = JSON.stringify(objs);
  JSON.parse(json);
});

// 2️⃣ Math Loop Test
timer("Floating-point ops (100 M)", () => {
  let sum = 0;
  for (let i = 0; i < 100_000_000; i++) sum += Math.sin(i) * Math.cos(i);
  return sum;
});

// 3️⃣ File I/O Test
timer("File write/read (100 MB)", () => {
  const buffer = Buffer.alloc(100 * 1024 * 1024, "a");
  fs.writeFileSync("temp_test.bin", buffer);
  const data = fs.readFileSync("temp_test.bin");
  fs.unlinkSync("temp_test.bin");
  return data.length;
});

// 4️⃣ Simulated ANN Vector Add
timer("ANN vector insert (1 000 × 1536)", () => {
  const DIM = 1536;
  const VECTORS = 1000;
  const embeddings = Array.from({ length: VECTORS }, () =>
    Float32Array.from({ length: DIM }, () => Math.random())
  );
  let dot = 0;
  for (let i = 0; i < VECTORS - 1; i++) {
    const a = embeddings[i], b = embeddings[i + 1];
    let sum = 0;
    for (let j = 0; j < DIM; j++) sum += a[j] * b[j];
    dot += sum;
  }
  return dot;
});

console.log("\n✅ Benchmark complete");
