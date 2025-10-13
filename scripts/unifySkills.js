// scripts/normalize_all_skills_ai.js
import "dotenv/config";
import OpenAI from "openai";
import stringSimilarity from "string-similarity";
import supabase from "../utils/supabase.js";
import  fetchSkillsExtracted  from "../hooks/fetchSkillsExtracted.js"
import  fetchConsolidatedSkills  from "../hooks/fetchConsolidatedSkills.js"

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
  return skill.trim().toLowerCase().replace(/\s+/g, "");
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
function findSimilarSkills(skill, dbSkills, maxResults = 10, threshold = 0.5) {
  if (typeof skill !== "string") return [];
  const cleanSkill = canonicalizeSkillName(skill);
  if (!Array.isArray(dbSkills) || dbSkills.length === 0) return [];

  const matches = stringSimilarity.findBestMatch(cleanSkill, dbSkills);
  const similar = matches.ratings
    .filter((m) => m.rating > threshold)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, maxResults)
    .map((m) => m.target);

  return similar
}

/* -----------------------------
   NORMALIZE A BATCH OF SKILLS
----------------------------- */
async function normalizeSkillBatch(batchSkills, dbSkills, batchIndex, totalBatches) {
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

  console.log(`🧩 Normalizing batch ${batchIndex}/${totalBatches}... (${batchSkills.length} skills)`);

  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: "You are a skill normalization engine. Output valid JSON only with a 'mappings' object.",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: 4000,
  });

  const output = (completion.choices[0].message.content.trim())
  .replace(/```json/g, "")
  .replace(/```/g, "")
  .trim();;



  const usage = completion.usage || { prompt_tokens: 0, completion_tokens: 0 };

  // Track tokens & cost
  totalInput += usage.prompt_tokens;
  totalOutput += usage.completion_tokens;
  const requestCost =
    usage.prompt_tokens * PRICES[MODEL].input +
    usage.completion_tokens * PRICES[MODEL].output;
  totalCost += requestCost;

  console.log(
    `✅ Batch ${batchIndex}/${totalBatches} done → input=${usage.prompt_tokens}, output=${usage.completion_tokens}, cost=$${requestCost.toFixed(5)}`
  );

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (err) {
    console.error("⚠️ JSON parse failed, using fallback:", output.slice(0, 200));
    parsed = { mappings: {} };
  }

  // Canonicalize outputs
const canonicalizedMappings = {};
for (const [raw, normalized] of Object.entries(parsed.mappings || {})) {
  const cleanRaw = canonicalizeSkillName(raw);
  const cleanNorm = canonicalizeSkillName(normalized);
  if (cleanRaw && cleanNorm) canonicalizedMappings[cleanRaw] = cleanNorm;
}

  // If you want to inspect them all
  Object.entries(canonicalizedMappings).forEach(([key, value], i) => {
    console.log("Index:", i);
    console.log(tasks[i])
    console.log("Raw Skill:", key);
    console.log("Normalized Skill:", value);

    // Find the task that matches this skill
    const task = tasks.find(t => canonicalizeSkillName(t.skill) === key);
    if (task) {
      console.log("Possible matches:", task.possible_matches);
    }

    console.log("–––––––––––––––––––––––––––––––––––––––");
  });


  return canonicalizedMappings;
}

/* -----------------------------
   FINAL CONSOLIDATION PHASE
----------------------------- */
async function consolidateSimilarSkills() {
  console.log("🧹 Running global consolidation across all skills (merge + replace)...");

  // 1️⃣ Fetch current skills table
  const { data: oldSkills, error: oldError } = await supabase
    .from("skills")
    .select("skill_name, total_references");

  if (oldError) throw oldError;

  // 2️⃣ Build canonicalized map that merges close matches
  const canonical = {};

  for (const row of oldSkills) {
    const clean = canonicalizeSkillName(row.skill_name);

    // Find existing canonical key above 0.85 similarity
    const matchKey = Object.keys(canonical).find(
      (k) => stringSimilarity.compareTwoStrings(clean.toLowerCase(), k.toLowerCase()) > 0.85
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
  console.log(`🔢 Reduced from ${oldSkills.length} → ${cleanedArray.length} canonical skills`);

  // 3️⃣ Fetch any new skills added by this normalization run
  const { data: newSkills, error: newError } = await supabase
    .from("skills") // or wherever your new ones were stored before this consolidation step
    .select("skill_name, total_references")
    .maybeSingle();

  if (!newError && Array.isArray(newSkills)) {
    for (const newSkill of newSkills) {
      const clean = canonicalizeSkillName(newSkill.skill_name);
      const matchKey = Object.keys(canonical).find(
        (k) => stringSimilarity.compareTwoStrings(clean.toLowerCase(), k.toLowerCase()) > 0.85
      );
      if (matchKey) {
        canonical[matchKey].total_references += newSkill.total_references;
      } else {
        canonical[clean] = {
          skill_name: clean,
          total_references: newSkill.total_references,
        };
      }
    }
  }

  const finalArray = Object.values(canonical);
  console.log(`✅ Final consolidated size: ${finalArray.length}`);

  // 4️⃣ Replace old table with merged data
  await supabase.from("skills").delete().neq("skill_name", "");
  // const { error: insertError } = await supabase.from("skills").insert(finalArray);
  if (insertError) console.error("❌ Insert error:", insertError);
  else console.log("✅ Merged and replaced successfully without losing totals.");
}


/* -----------------------------
   MAIN NORMALIZATION PIPELINE
----------------------------- */
export async function normalizeAllSkills() {
  console.log("🚀 Starting AI-based normalization with similarity matching...");

  // 1️⃣ Fetch both extracted and consolidated skill sets
  const extracted = await fetchSkillsExtracted();
  // const consolidated = await fetchConsolidatedSkills();
  const consolidated = []

  console.log(`📦 skills_extracted count: ${extracted.length}`);
  console.log(`📦 consolidated_skills count: ${consolidated.length}`);

  // 2️⃣ Identify new rows (delta-based)
  const consolidatedIds = new Set(consolidated.map((c) => c.processing_id));
  const newRows = extracted.filter((row) => !consolidatedIds.has(row.processing_id));

  console.log(`🆕 Found ${newRows.length} new unprocessed skill rows out of ${extracted.length} total.`);

  // 3️⃣ Skip if no new rows or too few (to save tokens)
  if (newRows.length === 0) {
    console.log("✅ No new skills to normalize — all caught up!");
    return;
  }
  if (newRows.length < 5) {
    console.log("⏸️ Fewer than 5 new jobs — skipping normalization for now.");
    return;
  }

  const rows = newRows;
  console.log(`📦 Proceeding with ${rows.length} new skill extraction rows.`);

  // 4️⃣ Gather unique skills
  const allSkills = new Set();
  for (const row of rows) {
    (row.required_skills || []).forEach((s) => allSkills.add(canonicalizeSkillName(s)));
    (row.skills_to_learn || []).forEach((s) => allSkills.add(canonicalizeSkillName(s)));
  }

  const uniqueSkills = Array.from(allSkills).filter(Boolean);
  console.log(`🧠 Found ${uniqueSkills.length} unique raw skills to normalize.`);

  // 5️⃣ Process in batches
  const totalBatches = Math.ceil(uniqueSkills.length / CHUNK_SIZE);
  const normalizationMap = {};

  for (let i = 0; i < uniqueSkills.length; i += CHUNK_SIZE) {
    const batch = uniqueSkills.slice(i, i + CHUNK_SIZE);
    const batchIndex = Math.floor(i / CHUNK_SIZE) + 1;

    // 🔍 Fetch fresh DB skills before each batch
    const dbSkills = await fetchExistingSkills();

    // 🤖 Normalize batch
    const batchMap = await normalizeSkillBatch(batch, dbSkills, batchIndex, totalBatches);
    Object.assign(normalizationMap, batchMap);

    // 💾 Apply normalization
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

    // 🧮 Count frequencies
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

    const unifiedSkills = Object.entries(frequencyMap).map(([skill_name, total_references]) => ({
      skill_name,
      total_references,
    }));

    // 💾 Insert into Supabase
    console.log(`💾 Inserting batch ${batchIndex} into Supabase...`);

    // const { error: insertError1 } = await supabase
    //   .from("consolidated_skills")
    //   .upsert(consolidatedBatch, { onConflict: "processing_id" });
    // if (insertError1) console.error("❌ consolidated_skills insert failed:", insertError1);

    // const { error: insertError2 } = await supabase
    //   .from("skills")
    //   .upsert(unifiedSkills, { onConflict: "skill_name" });
    // if (insertError2) console.error("❌ skills insert failed:", insertError2);

    // 🧾 Log usage
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
        new_jobs_processed: newRows.length,
        total_jobs_in_skills_extracted: extracted.length,
      },
    ]);

    console.log(`✅ Batch ${batchIndex} inserted & logged.`);
    await new Promise((r) => setTimeout(r, 1000)); // prevent rate limiting
  }

  // 🧹 Consolidate globally
  await consolidateSimilarSkills();

  // 🧾 Final Summary
  const totalTokens = totalInput + totalOutput;
  console.log("\n📊 TOKEN & COST SUMMARY");
  console.log(`Input tokens: ${totalInput}`);
  console.log(`Output tokens: ${totalOutput}`);
  console.log(`Total tokens: ${totalTokens}`);
  console.log(`💰 Total cost: $${totalCost.toFixed(4)}`);
  console.log("🏁 Normalization complete!");
}
