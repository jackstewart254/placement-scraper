import "dotenv/config";
import OpenAI from "openai";
import supabase from "../utils/supabase.js";
import fetchDescriptions from "../hooks/fetchDescriptions.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* -----------------------------
   CONFIGURATION
----------------------------- */
const MODEL = "gpt-4o-mini";
const BATCH_SIZE = 5;
const DELAY_MS = 1000;

// 💰 USD per 1M tokens
const PRICES = {
  "gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
};

let totalInput = 0;
let totalOutput = 0;

/* -----------------------------
   EXTRACT FROM RAW DESCRIPTION
----------------------------- */
async function extractFromDescription(description) {
  const prompt = `
Read the following job description carefully.

Extract *all explicit and implicit skills* mentioned — both technical and behavioural.
Group them into exactly two lists:

1️⃣ "required_skills" → skills, tools, languages, technologies, or personal traits the candidate must ALREADY HAVE.
   - Be as specific as possible. 
   - If the text says "programming" or "software development", identify or infer the likely languages or technologies mentioned elsewhere (e.g. Python, JavaScript, SQL, React).
   - Include behavioural or interpersonal traits such as "Teamwork", "Attention to detail", etc.

2️⃣ "skills_to_learn" → skills, tools, or abilities the candidate WILL DEVELOP or strengthen in this role.
   - Again, be specific and granular (e.g. "Cloud deployment with AWS" instead of just "cloud skills").

🚫 DO NOT include:
- Academic qualifications (e.g. "Bachelor's degree", "A-levels")
- Certificates (e.g. "AWS Certified", "CFA")
- Time or experience requirements
- Generic company or role info

Return ONLY valid JSON like:
{
  "required_skills": ["Skill 1", "Skill 2"],
  "skills_to_learn": ["Skill A", "Skill B"]
}

No commentary or text outside JSON.

---
${description.slice(0, 8000)}
---`;

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "You extract *specific technical skills, tools, and personal traits* from job descriptions. Output valid JSON only.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0,
    max_tokens: 400,
    response_format: { type: "json_object" }, // enforce JSON output
  });

  const output = completion.choices[0].message.content.trim();
  const usage = completion.usage || {};

  totalInput += usage.prompt_tokens || 0;
  totalOutput += usage.completion_tokens || 0;

  const cost =
    usage.prompt_tokens * PRICES[MODEL].input +
    usage.completion_tokens * PRICES[MODEL].output;

  const parsed = JSON.parse(output);

  const required = parsed.required_skills || [];
  const toLearn = parsed.skills_to_learn || [];

  return {
    required_skills: required,
    skills_to_learn: toLearn,
    skills_csv: [...required, ...toLearn].join(", "),
    input_tokens: usage.prompt_tokens || 0,
    output_tokens: usage.completion_tokens || 0,
    total_cost: cost,
  };
}

/* -----------------------------
   PROCESS SINGLE DESCRIPTION
----------------------------- */
async function processDescription({ processing_id, description }) {
  const result = await extractFromDescription(description);

  console.log(
    `✅ Processed ${processing_id} → ${
      result.required_skills.length + result.skills_to_learn.length
    } skills`
  );

  return {
    processing_id,
    required_skills: result.required_skills,
    skills_to_learn: result.skills_to_learn,
    skills_csv: result.skills_csv,

    // Rename token fields to match Supabase schema
    extract_input_tokens: result.input_tokens,
    extract_output_tokens: result.output_tokens,
    total_cost: result.total_cost,

    // Optional: placeholders for clean model (null if skipped)
    clean_input_tokens: null,
    clean_output_tokens: null,
  };
}

/* -----------------------------
   MAIN PIPELINE
----------------------------- */
export async function runSkillExtractionPipeline() {
  console.log("🚀 Starting unified extraction pipeline (raw descriptions)...");

  // 1️⃣ Get already processed IDs
  const { data: processedRows, error: processedError } = await supabase
    .from("skills_extracted")
    .select("processing_id");

  if (processedError) throw processedError;
  const processedIds = new Set(processedRows.map((r) => r.processing_id));

  // 2️⃣ Fetch unprocessed descriptions
  const descriptions = await fetchDescriptions()

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

    console.log(valid);

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
  console.log(`Input tokens: ${totalInput}, Output tokens: ${totalOutput}`);
  console.log(`Total tokens: ${totalInput + totalOutput}`);

  const totalCost =
    totalInput * PRICES[MODEL].input + totalOutput * PRICES[MODEL].output;
  console.log(`💰 Total cost: $${totalCost.toFixed(4)}`);
}
