// scripts/normalize_all_skills_ai.js
import "dotenv/config";
import OpenAI from "openai";
import stringSimilarity from "string-similarity";
import supabase from "../utils/supabase.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";
const CHUNK_SIZE = 200;

// 💰 OpenAI pricing per 1M tokens (USD)
const PRICES = {
  "gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
};

// Track global totals
let totalInput = 0;
let totalOutput = 0;
let totalCost = 0;

/* -----------------------------
   CANONICALIZE SKILL NAME
----------------------------- */
function canonicalizeSkillName(skill) {
  if (!skill || typeof skill !== "string") return "";
  return skill
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/* -----------------------------
   FETCH EXISTING SKILLS FROM DB
----------------------------- */
async function fetchExistingSkills() {
  const { data, error } = await supabase.from("skills").select("skill_name");
  if (error) throw error;
  return (data || []).map((d) => canonicalizeSkillName(d.skill_name));
}

/* -----------------------------
   FIND SIMILAR SKILLS LOCALLY
----------------------------- */
function findSimilarSkills(skill, dbSkills, maxResults = 10, threshold = 0.4) {
  if (typeof skill !== "string") return [];
  const cleanSkill = canonicalizeSkillName(skill);
  if (!Array.isArray(dbSkills) || dbSkills.length === 0) return [];

  const matches = stringSimilarity.findBestMatch(cleanSkill, dbSkills);
  return matches.ratings
    .filter((m) => m.rating > threshold)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, maxResults)
    .map((m) => m.target);
}

/* -----------------------------
   NORMALIZE A BATCH OF SKILLS
----------------------------- */
async function normalizeSkillBatch(
  batchSkills,
  dbSkills,
  batchIndex,
  totalBatches
) {
  const tasks = batchSkills.map((skill) => ({
    skill: canonicalizeSkillName(skill),
    possible_matches: findSimilarSkills(skill, dbSkills),
  }));

  const prompt = `
You are cleaning and unifying professional skill names.

For each skill, choose the best match from the provided "possible_matches" if it represents the same concept.
If none of the matches are correct, output the skill unchanged.

Return valid JSON only:
{
  "mappings": {
    "raw_skill": "Normalized Skill"
  }
}

Here are the tasks:
${JSON.stringify(tasks, null, 2)}
`;

  console.log(
    `🧩 Normalizing batch ${batchIndex}/${totalBatches}... (${batchSkills.length} skills)`
  );

  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You are a skill normalization engine. Output valid JSON only with a 'mappings' object.",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: 4000,
  });

  const output = completion.choices[0].message.content.trim();
  const usage = completion.usage || { prompt_tokens: 0, completion_tokens: 0 };

  // Track tokens & cost
  totalInput += usage.prompt_tokens;
  totalOutput += usage.completion_tokens;
  const requestCost =
    usage.prompt_tokens * PRICES[MODEL].input +
    usage.completion_tokens * PRICES[MODEL].output;
  totalCost += requestCost;

  console.log(
    `✅ Batch ${batchIndex}/${totalBatches} done → input=${
      usage.prompt_tokens
    }, output=${usage.completion_tokens}, cost=$${requestCost.toFixed(5)}`
  );

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (err) {
    console.error(
      "⚠️ JSON parse failed, using fallback:",
      output.slice(0, 200)
    );
    parsed = { mappings: {} };
  }

  // Canonicalize outputs
  const canonicalizedMappings = {};
  for (const [raw, normalized] of Object.entries(parsed.mappings || {})) {
    const cleanRaw = canonicalizeSkillName(raw);
    const cleanNorm = canonicalizeSkillName(normalized);
    if (cleanRaw && cleanNorm) canonicalizedMappings[cleanRaw] = cleanNorm;
  }

  return canonicalizedMappings;
}

/* -----------------------------
   FINAL CONSOLIDATION PHASE
----------------------------- */
async function consolidateSimilarSkills() {
  console.log("🧹 Running global consolidation across all skills...");

  const { data: allSkills, error } = await supabase
    .from("skills")
    .select("skill_name, total_references");

  if (error) throw error;

  const canonical = {};

  for (const row of allSkills) {
    const clean = canonicalizeSkillName(row.skill_name);

    // Find close match (threshold 0.85)
    const matchKey = Object.keys(canonical).find(
      (k) =>
        stringSimilarity.compareTwoStrings(
          clean.toLowerCase(),
          k.toLowerCase()
        ) > 0.85
    );

    if (matchKey) {
      canonical[matchKey].total_references += row.total_references;
    } else {
      canonical[clean] = {
        skill_name: clean,
        total_references: row.total_references,
      };
    }
  }

  const cleanedArray = Object.values(canonical);

  // Replace the old table contents
  await supabase.from("skills").delete().neq("skill_name", "");
  await supabase.from("skills").insert(cleanedArray);
  console.log(
    `✅ Consolidated to ${cleanedArray.length} globally unique skills.`
  );
}

/* -----------------------------
   MAIN NORMALIZATION PIPELINE
----------------------------- */
export async function normalizeAllSkills() {
  console.log("🚀 Starting AI-based normalization with similarity matching...");

  // 1️⃣ Fetch raw data
  const { data: rows, error } = await supabase
    .from("skills_extracted")
    .select("processing_id, required_skills, skills_to_learn");

  if (error) throw error;
  console.log(`📦 Fetched ${rows.length} job rows.`);

  // 2️⃣ Gather all unique skills
  const allSkills = new Set();
  for (const row of rows) {
    (row.required_skills || []).forEach((s) =>
      allSkills.add(canonicalizeSkillName(s))
    );
    (row.skills_to_learn || []).forEach((s) =>
      allSkills.add(canonicalizeSkillName(s))
    );
  }
  const uniqueSkills = Array.from(allSkills).filter(Boolean);
  console.log(`🧠 Found ${uniqueSkills.length} unique raw skills.`);

  // 3️⃣ Process in batches
  const totalBatches = Math.ceil(uniqueSkills.length / CHUNK_SIZE);
  const normalizationMap = {};

  for (let i = 0; i < uniqueSkills.length; i += CHUNK_SIZE) {
    const batch = uniqueSkills.slice(i, i + CHUNK_SIZE);
    const batchIndex = Math.floor(i / CHUNK_SIZE) + 1;

    // 🔍 Fetch fresh DB skills before each batch for grounding
    const dbSkills = await fetchExistingSkills();

    // 🤖 Normalize batch
    const batchMap = await normalizeSkillBatch(
      batch,
      dbSkills,
      batchIndex,
      totalBatches
    );
    Object.assign(normalizationMap, batchMap);

    // 💾 Apply normalization to rows
    const consolidatedBatch = rows.map((row) => {
      const normRequired = (row.required_skills || [])
        .map((s) => canonicalizeSkillName(normalizationMap[s] || s))
        .filter(Boolean);
      const normLearn = (row.skills_to_learn || [])
        .map((s) => canonicalizeSkillName(normalizationMap[s] || s))
        .filter(Boolean);
      const allNorm = [...normRequired, ...normLearn];
      return {
        processing_id: row.processing_id,
        required_skills: normRequired,
        skills_to_learn: normLearn,
        skills_csv: allNorm.join(", "),
      };
    });

    // 🧮 Count frequencies for this batch
    const frequencyMap = {};
    for (const row of consolidatedBatch) {
      const allRowSkills = [
        ...(row.required_skills || []),
        ...(row.skills_to_learn || []),
      ];
      for (const skill of allRowSkills) {
        const clean = canonicalizeSkillName(skill);
        frequencyMap[clean] = (frequencyMap[clean] || 0) + 1;
      }
    }

    const unifiedSkills = Object.entries(frequencyMap).map(
      ([skill_name, total_references]) => ({
        skill_name,
        total_references,
      })
    );

    // 💾 Insert batch into Supabase
    console.log(`💾 Inserting batch ${batchIndex} into Supabase...`);

    const { error: insertError1 } = await supabase
      .from("consolidated_skills")
      .upsert(consolidatedBatch, { onConflict: "processing_id" });
    if (insertError1)
      console.error("❌ consolidated_skills insert failed:", insertError1);

    const { error: insertError2 } = await supabase
      .from("skills")
      .upsert(unifiedSkills, { onConflict: "skill_name" });
    if (insertError2) console.error("❌ skills insert failed:", insertError2);

    // 🧾 Log per-batch usage
    const batchCost =
      totalInput * PRICES[MODEL].input + totalOutput * PRICES[MODEL].output;
    await supabase.from("normalization_logs").insert([
      {
        run_timestamp: new Date().toISOString(),
        batch_number: batchIndex,
        model_used: MODEL,
        input_tokens: totalInput,
        output_tokens: totalOutput,
        total_cost_usd: batchCost,
      },
    ]);

    console.log(`✅ Batch ${batchIndex} inserted & logged.`);
    await new Promise((r) => setTimeout(r, 1000)); // prevent rate limiting
  }

  // 🧹 Run global consolidation at the end
  await consolidateSimilarSkills();

  // 🧾 Final summary
  const totalTokens = totalInput + totalOutput;
  console.log("\n📊 TOKEN & COST SUMMARY");
  console.log(`Input tokens: ${totalInput}`);
  console.log(`Output tokens: ${totalOutput}`);
  console.log(`Total tokens: ${totalTokens}`);
  console.log(`💰 Total cost: $${totalCost.toFixed(4)}`);
  console.log("🏁 Normalization complete!");
}
