// scripts/extract_skills_pipeline.js
import "dotenv/config";
import OpenAI from "openai";
import supabase from "../utils/supabase.js";
import { encode } from "gpt-tokenizer";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* -----------------------------
   CONFIGURATION
----------------------------- */
const CLEAN_MODEL = "gpt-4o-mini";
const EXTRACT_MODEL = "gpt-5";
const BATCH_SIZE = 5;
const DELAY_MS = 1000;

let totalCleanTokens = 0;
let totalExtractTokens = 0;
const allSkills = new Set();

/* -----------------------------
   CLEAN DESCRIPTION
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

  const messages = [
    { role: "system", content: "Clean this text..." },
    { role: "user", content: prompt },
  ];

  const inputTokens = messages.reduce((sum, msg) => sum + encode(msg.content).length, 0);
  totalCleanTokens += inputTokens;

  console.log(`🧮 [CLEAN] Estimated tokens: ${inputTokens}`);

  const completion = await openai.chat.completions.create({
    model: CLEAN_MODEL,
    messages,
  });

  const cleaned = (completion.choices[0].message.content || "").trim();
  console.log("🧹 Cleaned description preview:", cleaned.slice(0, 120));
  return { cleaned, clean_tokens: inputTokens };
}

/* -----------------------------
   EXTRACT SKILLS
----------------------------- */
async function extractSkills(cleanedText) {
  const recentVocabulary = Array.from(allSkills).slice(-200).join(", ");

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

  const input = [
    { role: "system", content: "Extract skills as JSON, maintaining consistent naming conventions." },
    { role: "user", content: prompt },
  ];

  const inputTokens = input.reduce((sum, msg) => sum + encode(msg.content).length, 0);
  totalExtractTokens += inputTokens;

  console.log(`🧮 [EXTRACT] Estimated tokens: ${inputTokens}`);

  const response = await openai.responses.create({
    model: EXTRACT_MODEL,
    input,
  });

  const output = (response.output_text || "").trim();
  const parsed = JSON.parse(output);

  const required = parsed.required_skills || [];
  const toLearn = parsed.skills_to_learn || [];

  [...required, ...toLearn].forEach((s) => s && s.trim() && allSkills.add(s.trim()));

  console.log("🧠 Required:", required);
  console.log("📘 To Learn:", toLearn);

  return {
    required_skills: required,
    skills_to_learn: toLearn,
    skills_csv: [...required, ...toLearn].join(", "),
    extract_tokens: inputTokens,
  };
}

/* -----------------------------
   PROCESS SINGLE DESCRIPTION
----------------------------- */
async function processDescription({ processing_id, description }) {
  const { cleaned, clean_tokens } = await cleanDescription(description);
  if (!cleaned) return null;

  const { required_skills, skills_to_learn, skills_csv, extract_tokens } = await extractSkills(cleaned);

  console.log(`✅ Processed ${processing_id} → ${required_skills.length + skills_to_learn.length} skills`);

  return {
    processing_id,
    cleaned_description: cleaned,
    required_skills,
    skills_to_learn,
    skills_csv,
    clean_tokens,
    extract_tokens,
  };
}

/* -----------------------------
   MAIN PIPELINE
----------------------------- */
export async function runSkillExtractionPipeline() {
  console.log("🚀 Starting skill extraction pipeline...");

  // 1️⃣ Get all processing IDs already in skills_extracted
  const { data: processedRows, error: processedError } = await supabase
    .from("skills_extracted")
    .select("processing_id");

  if (processedError) throw processedError;

  const processedIds = new Set(processedRows.map((r) => r.processing_id));
  console.log(`🧩 Already processed: ${processedIds.size} records`);

  // 2️⃣ Fetch only unprocessed descriptions
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
      `🧩 Processing batch ${Math.ceil(i / BATCH_SIZE) + 1} / ${Math.ceil(
        unprocessed.length / BATCH_SIZE
      )} (${batch.length} items)`
    );

    const processedBatch = await Promise.all(batch.map(processDescription));
    const valid = processedBatch.filter(Boolean);

    if (valid.length > 0) {
      const { error: insertError } = await supabase
        .from("skills_extracted")
        .upsert(valid);

      if (insertError) throw new Error(insertError.message);
      console.log(`💾 Saved ${valid.length} new results to Supabase.`);
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  // 4️⃣ Summary
  console.log("🏁 Pipeline complete.");
  console.log("📊 TOKEN USAGE SUMMARY:");
  console.log(`🧼 Clean total tokens: ${totalCleanTokens}`);
  console.log(`🧠 Extract total tokens: ${totalExtractTokens}`);
  console.log(`📈 Combined total tokens: ${totalCleanTokens + totalExtractTokens}`);
  console.log("🧾 Unified Skill Vocabulary Collected:", allSkills.size);
}
