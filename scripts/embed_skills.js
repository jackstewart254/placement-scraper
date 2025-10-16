process.on("unhandledRejection", (reason) => {
  console.error("⚠️ Unhandled Promise Rejection:", reason);
});

import OpenAI from "openai";
import supabase from "../utils/supabase.js";
import fetchSkillsExtracted from "../hooks/fetchSkillsExtracted.js";
import fetchSkillVectors from "../hooks/fetchSkillsVector.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = "text-embedding-3-small";
const EMBED_BATCH_SIZE = 100; // safe batch size
const INSERT_BATCH_SIZE = 100; // for Supabase
const PRICES = {
  "text-embedding-3-small": { input: 0.02 / 1_000_000, output: 0 },
};

/* ------------------------------------------------------------------ */
/* 📦 1. Utility to insert in smaller chunks */
async function insertInChunks(rows, chunkSize = INSERT_BATCH_SIZE) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from("skills_vectors").insert(chunk);
    if (error) console.error("❌ Insert error:", error);
    else console.log(`🧩 Inserted ${chunk.length} embeddings`);
  }
}

/* ------------------------------------------------------------------ */
/* 🧠 2. Fetch only skills without embeddings */
async function fetchUnembeddedSkills() {
  const skills = await fetchSkillsExtracted();
  const vectors = await fetchSkillVectors();

  const vectorIds = new Set(vectors.map((v) => v.extracted_id));
  const unembedded = skills.filter((s) => !vectorIds.has(s.id));

  console.log(`🔎 Found ${unembedded.length} unembedded skills`);
  return unembedded;
}

/* ------------------------------------------------------------------ */
/* 🤖 3. Batch-embed and store */
async function embedAndStore(skills) {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;

  for (let i = 0; i < skills.length; i += EMBED_BATCH_SIZE) {
    const chunk = skills.slice(i, i + EMBED_BATCH_SIZE);
    const inputs = chunk
      .map((s) => s.canonicalized?.trim())
      .filter((t) => typeof t === "string" && t.length > 0);

    console.log(`📦 Embedding batch ${i / EMBED_BATCH_SIZE + 1} (${inputs.length} skills)`);

    const start = Date.now();
    const response = await openai.embeddings.create({
      model: MODEL,
      input: inputs,
    });
    const duration = ((Date.now() - start) / 1000).toFixed(2);

    const rows = chunk.map((s, idx) => ({
      extracted_id: s.id,
      embedding: response.data[idx].embedding,
    }));

    await insertInChunks(rows);

    // Track usage and cost
    const usage = response.usage || {};
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    const cost =
      inputTokens * PRICES[MODEL].input +
      outputTokens * (PRICES[MODEL].output || 0);

    totalInput += inputTokens;
    totalOutput += outputTokens;
    totalCost += cost;

    console.log(`✅ Embedded ${rows.length} skills in ${duration}s`);
    console.log(`🧾 Tokens: ${inputTokens} | Cost: $${cost.toFixed(5)}\n`);

    // Optional: sleep a little between batches (helps avoid rate limits)
    await new Promise((r) => setTimeout(r, 200));
  }

  return { totalInput, totalOutput, totalCost };
}

/* ------------------------------------------------------------------ */
/* 🚀 4. Main runner */
async function main() {
  const unembedded = await fetchUnembeddedSkills();
  if (!unembedded.length) {
    console.log("🎉 All skills already embedded!");
    return;
  }

  const { totalInput, totalOutput, totalCost } = await embedAndStore(unembedded);

  console.log("🏁 All embeddings stored successfully.");
  console.log(
    `📊 Summary — Input Tokens: ${totalInput}, Output Tokens: ${totalOutput}, Cost: $${totalCost.toFixed(
      5
    )}`
  );
}

export default main;
