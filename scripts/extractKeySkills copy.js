// scripts/extract_skills_pipeline.js
import "dotenv/config";
import OpenAI from "openai";
import supabase from "../utils/supabase.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* -----------------------------
   CONFIGURATION
----------------------------- */
const CLEAN_MODEL = "gpt-4o-mini";
const EXTRACT_MODEL = "gpt-5";
const BATCH_SIZE = 5;
const DELAY_MS = 1000;

const PRICES = {
  "gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  "gpt-5": { input: 1.25 / 1_000_000, output: 10.0 / 1_000_000 },
};

let totalCleanInput = 0;
let totalCleanOutput = 0;
let totalExtractInput = 0;
let totalExtractOutput = 0;

const allSkills = new Set();

/* -----------------------------
   CLEAN DESCRIPTION (GPT-4o-mini)
----------------------------- */
async function cleanDescription(text) {
  const prompt = `
Clean and condense this job description while preserving every sentence that
mentions SKILLS, TOOLS, TECHNOLOGIES, or RESPONSIBILITIES.
Remove company intros, perks, and diversity statements.
Return concise plain text only.

---
${text}
---`;

  const completion = await openai.chat.completions.create({
    model: CLEAN_MODEL,
    messages: [
      { role: "system", content: "Clean this text..." },
      { role: "user", content: prompt },
    ],
  });

  const cleaned = (completion.choices[0].message.content || "").trim();
  const usage = completion.usage || {};

  totalCleanInput += usage.prompt_tokens || 0;
  totalCleanOutput += usage.completion_tokens || 0;

  console.log(
    `🧼 [CLEAN] input=${usage.prompt_tokens}, output=${usage.completion_tokens}`
  );
  console.log("🧹 Cleaned description preview:", cleaned.slice(0, 120));

  const cleanCost =
    usage.prompt_tokens * PRICES[CLEAN_MODEL].input +
      usage.completion_tokens * PRICES[CLEAN_MODEL].output || 0;

  return {
    cleaned,
    clean_input_tokens: usage.prompt_tokens || 0,
    clean_output_tokens: usage.completion_tokens || 0,
    clean_cost: cleanCost,
  };
}

/* -----------------------------
   EXTRACT SKILLS (GPT-5)
----------------------------- */
async function extractSkills(cleanedText) {
  const prompt = `

From the following text, identify two separate lists of skills:
1️⃣ "required_skills" → skills the candidate must already have.
2️⃣ "skills_to_learn" → skills the candidate will learn or develop.

Output ONLY valid JSON like:
{
  "required_skills": ["Skill 1", "Skill 2"],
  "skills_to_learn": ["Skill A", "Skill B"]
}

---
${cleanedText}
---`;

  const response = await openai.chat.completions.create({
    model: EXTRACT_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are an AI that extracts skill names from job descriptions. Output only valid JSON.",
      },
      { role: "user", content: prompt },
    ],
  });

  const output = (response.choices[0].message.content || "").trim();

  const usage = response.usage || {};

  totalExtractInput += usage.prompt_tokens || 0;
  totalExtractOutput += usage.completion_tokens || 0;

  console.log(
    `🧠 [EXTRACT] input=${usage.prompt_tokens}, output=${usage.completion_tokens}`
  );

  const extractCost =
    usage.prompt_tokens * PRICES[EXTRACT_MODEL].input +
      usage.completion_tokens * PRICES[EXTRACT_MODEL].output || 0;

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (err) {
    console.error("⚠️ JSON parse failed:", output);
    parsed = { required_skills: [], skills_to_learn: [] };
  }

  const required = parsed.required_skills || [];
  const toLearn = parsed.skills_to_learn || [];

  [...required, ...toLearn].forEach(
    (s) => s && s.trim() && allSkills.add(s.trim())
  );

  return {
    required_skills: required,
    skills_to_learn: toLearn,
    skills_csv: [...required, ...toLearn].join(", "),
    extract_input_tokens: usage.prompt_tokens || 0,
    extract_output_tokens: usage.completion_tokens || 0,
    extract_cost: extractCost,
  };
}

/* -----------------------------
   PROCESS SINGLE DESCRIPTION
----------------------------- */
async function processDescription({ processing_id, description }) {
  const cleanResult = await cleanDescription(description);
  if (!cleanResult.cleaned) return null;

  const extractResult = await extractSkills(cleanResult.cleaned);

  console.log(
    `✅ Processed ${processing_id} → ${
      extractResult.required_skills.length +
      extractResult.skills_to_learn.length
    } skills`
  );

  const totalCost = cleanResult.clean_cost + extractResult.extract_cost;

  return {
    processing_id,
    cleaned_description: cleanResult.cleaned,
    required_skills: extractResult.required_skills,
    skills_to_learn: extractResult.skills_to_learn,
    skills_csv: extractResult.skills_csv,

    // 🧮 New per-model columns
    clean_input_tokens: cleanResult.clean_input_tokens,
    clean_output_tokens: cleanResult.clean_output_tokens,
    extract_input_tokens: extractResult.extract_input_tokens,
    extract_output_tokens: extractResult.extract_output_tokens,

    // 💰 Total cost in USD
    total_cost: totalCost,
  };
}

/* -----------------------------
   MAIN PIPELINE
----------------------------- */
export async function runSkillExtractionPipeline() {
  console.log("🚀 Starting skill extraction pipeline...");

  // 1️⃣ Get already processed IDs
  const { data: processedRows, error: processedError } = await supabase
    .from("skills_extracted")
    .select("processing_id");

  if (processedError) throw processedError;
  const processedIds = new Set(processedRows.map((r) => r.processing_id));

  // 2️⃣ Fetch unprocessed descriptions
  const { data: descriptions, error: descError } = await supabase
    .from("descriptions")
    .select("processing_id, description")
    .not("description", "is", null);

  if (descError) throw descError;
  const unprocessed = descriptions.filter(
    (d) => !processedIds.has(d.processing_id)
  );

  console.log(`📦 Found ${unprocessed.length} unprocessed descriptions.`);

  // 3️⃣ Process in batches
  for (let i = 0; i < unprocessed.length; i += BATCH_SIZE) {
    const batch = unprocessed.slice(i, i + BATCH_SIZE);
    console.log(
      `🧩 Batch ${Math.ceil(i / BATCH_SIZE) + 1} / ${Math.ceil(
        unprocessed.length / BATCH_SIZE
      )} (${batch.length} items)`
    );

    const processedBatch = await Promise.all(batch.map(processDescription));
    const valid = processedBatch.filter(Boolean);

    if (valid.length > 0) {
      const { error: insertError } = await supabase
        .from("skills_extracted")
        .upsert(valid, { onConflict: "processing_id" });

      if (insertError) throw new Error(insertError.message);
      console.log(`💾 Saved ${valid.length} results to Supabase.`);
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  // 4️⃣ Summary
  console.log("\n🏁 Pipeline complete.");
  console.log("📊 TOKEN USAGE SUMMARY:");
  console.log(
    `🧼 CLEAN → input: ${totalCleanInput}, output: ${totalCleanOutput}, total: ${
      totalCleanInput + totalCleanOutput
    }`
  );
  console.log(
    `🧠 EXTRACT → input: ${totalExtractInput}, output: ${totalExtractOutput}, total: ${
      totalExtractInput + totalExtractOutput
    }`
  );

  const totalCleanCost =
    totalCleanInput * PRICES[CLEAN_MODEL].input +
    totalCleanOutput * PRICES[CLEAN_MODEL].output;

  const totalExtractCost =
    totalExtractInput * PRICES[EXTRACT_MODEL].input +
    totalExtractOutput * PRICES[EXTRACT_MODEL].output;

  console.log("\n💰 COST SUMMARY:");
  console.log(`🧼 Cleaning cost: $${totalCleanCost.toFixed(4)}`);
  console.log(`🧠 Extraction cost: $${totalExtractCost.toFixed(4)}`);
  console.log(
    `📈 Total cost: $${(totalCleanCost + totalExtractCost).toFixed(4)}`
  );
}
