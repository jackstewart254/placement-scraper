import fs from "fs";
import { Worker, isMainThread, parentPort } from "worker_threads";

if (isMainThread) {
  console.log("🚀 Node.js Extended Performance Benchmark\n");
  console.log(`Node.js version: ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}\n`);

  function timer(label, fn) {
    const start = performance.now();
    const result = fn();
    const end = performance.now();
    console.log(`${label}: ${(end - start).toFixed(2)} ms`);
    return result;
  }

  // 1️⃣ JSON Parsing Test (1 million objects)
  timer("JSON parse/stringify (1 000 000 objs)", () => {
    const objs = Array.from({ length: 1_000_000 }, (_, i) => ({
      id: i,
      x: Math.random(),
      y: Math.random(),
    }));
    const json = JSON.stringify(objs);
    JSON.parse(json);
  });

  // 2️⃣ Math Loop Test (300M ops)
  timer("Floating-point ops (300 M)", () => {
    let sum = 0;
    for (let i = 0; i < 300_000_000; i++) sum += Math.sin(i) * Math.cos(i);
    return sum;
  });

  // 3️⃣ File I/O Test (500 MB)
  timer("File write/read (500 MB)", () => {
    const buffer = Buffer.alloc(500 * 1024 * 1024, "a");
    fs.writeFileSync("temp_large.bin", buffer);
    const data = fs.readFileSync("temp_large.bin");
    fs.unlinkSync("temp_large.bin");
    return data.length;
  });

  // 4️⃣ ANN Vector Insert (5 000 × 1 536)
  timer("ANN vector insert (5 000 × 1 536)", () => {
    const DIM = 1536;
    const VECTORS = 5000;
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

  // 5️⃣ Multi-threaded Stress Test
  console.log("\n🧵 Spawning multi-threaded CPU stress test...");
  const THREADS = Math.min(6, navigator.hardwareConcurrency || 6);
  const promises = [];
  const start = performance.now();

  for (let i = 0; i < THREADS; i++) {
    promises.push(
      new Promise((resolve) => {
        const worker = new Worker(new URL(import.meta.url));
        worker.on("message", resolve);
      })
    );
  }

  Promise.all(promises).then(() => {
    const end = performance.now();
    console.log(`Multi-threaded math (6 workers × 100M ops each): ${(end - start).toFixed(2)} ms`);
    console.log("\n✅ Benchmark complete");
  });
} else {
  // Worker thread math workload
  let total = 0;
  for (let i = 0; i < 100_000_000; i++) total += Math.sin(i) * Math.cos(i);
  parentPort.postMessage(total);
}
