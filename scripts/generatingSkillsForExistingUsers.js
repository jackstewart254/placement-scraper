import "dotenv/config";
import OpenAI from "openai";
import stringSimilarity from "string-similarity";
import supabase from "../utils/supabase.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";
const CHUNK_SIZE = 25;

// 💰 OpenAI pricing per 1M tokens (USD)
const PRICES = {
  "gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
};

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
   FETCH EXISTING SKILLS
----------------------------- */
async function fetchExistingSkills() {
  const { data, error } = await supabase.from("skills").select("skill_name");
  if (error) throw error;
  return (data || []).map((d) => canonicalizeSkillName(d.skill_name));
}

/* -----------------------------
   EXTRACT SKILLS USING GPT
----------------------------- */
async function extractSkillsWithAI(userText) {
  const prompt = `
Extract specific professional, technical, and transferable skills from the following text.

Return ONLY valid JSON in the form:
{
  "skills": ["Skill 1", "Skill 2", "Skill 3", ...]
}

Text:
${userText}
`;

  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You extract concise, distinct skill names. Output valid JSON with a 'skills' array only.",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: 1000,
  });

  const usage = completion.usage || { prompt_tokens: 0, completion_tokens: 0 };
  totalInput += usage.prompt_tokens;
  totalOutput += usage.completion_tokens;
  totalCost +=
    usage.prompt_tokens * PRICES[MODEL].input +
    usage.completion_tokens * PRICES[MODEL].output;

  const output = completion.choices[0].message.content.trim();
  try {
    const parsed = JSON.parse(output);
    return parsed.skills || [];
  } catch {
    console.error("⚠️ Invalid JSON from GPT:", output);
    return [];
  }
}

/* -----------------------------
   FIND CLOSE MATCH (FUZZY)
----------------------------- */
function findClosestMatch(skill, dbSkills, threshold = 0.85) {
  const clean = canonicalizeSkillName(skill);
  let best = null;
  let bestScore = 0;

  for (const s of dbSkills) {
    const score = stringSimilarity.compareTwoStrings(
      clean.toLowerCase(),
      s.toLowerCase()
    );
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }

  if (bestScore >= threshold) return best; // already exists
  return clean; // new skill
}

/* -----------------------------
   LINK USER → SKILLS
----------------------------- */
async function linkUserToSkills(userId, matchedSkills) {
  if (!matchedSkills.length) return;

  // 1️⃣ Fetch skill IDs for all matched skill names
  const { data: skillRows, error: skillError } = await supabase
    .from("skills")
    .select("id, skill_name")
    .in("skill_name", matchedSkills);

  if (skillError) {
    console.error("❌ Failed to fetch skill IDs:", skillError.message);
    return;
  }

  // 2️⃣ Prepare user_skills inserts
  const userSkillRows = skillRows.map((row) => ({
    user_id: userId,
    skill_id: row.id,
  }));

  // 3️⃣ Upsert (avoid duplicates)
  const { error: insertError } = await supabase
    .from("user_skills")
    .upsert(userSkillRows, { onConflict: "user_id, skill_id" });

  if (insertError)
    console.error("❌ user_skills insert failed:", insertError.message);
  else
    console.log(`🔗 Linked ${userSkillRows.length} skills to user ${userId}`);
}

/* -----------------------------
   PROCESS ONE USER
----------------------------- */
async function processUser(user, dbSkills) {
  console.log(`👤 Processing user: ${user.user_id}`);

  // Combine all text fields into one coherent input
  const userText = [
    user.technical_skills,
    user.soft_skills,
    user.extra_curriculars,
    user.personal_projects,
  ]
    .filter(Boolean)
    .join(". ");

  if (!userText.trim()) {
    console.log("⚠️ Skipping user with no data.");
    return;
  }

  // Extract skills
  const extracted = await extractSkillsWithAI(userText);
  if (!extracted.length) {
    console.log("⚠️ No skills extracted by GPT.");
    return;
  }

  const cleanSkills = extracted
    .map(canonicalizeSkillName)
    .filter(Boolean)
    .filter((s, i, arr) => arr.indexOf(s) === i);

  // Normalize against dictionary
  const matchedSkills = cleanSkills.map((s) => findClosestMatch(s, dbSkills));

  // Identify new skills (not in dictionary)
  const existingSet = new Set(dbSkills);
  const newSkills = matchedSkills
    .filter((s) => !existingSet.has(s))
    .map((s) => ({ skill_name: s, total_references: 0 }));

  // Insert new skills into dictionary
  if (newSkills.length > 0) {
    const { error: insertError } = await supabase.from("skills").insert(newSkills);
    if (insertError)
      console.error("❌ Insert new skills failed:", insertError.message);
    else console.log(`✅ Added ${newSkills.length} new skills.`);
  }

  // Refresh dictionary after insert
  const updatedSkills = await fetchExistingSkills();

  // Re-match (to ensure we have canonical names for inserted ones)
  const finalMatchedSkills = cleanSkills.map((s) =>
    findClosestMatch(s, updatedSkills)
  );

  // Link user to these canonical skills
  await linkUserToSkills(user.user_id, finalMatchedSkills);

  console.log(
    `✅ Finished user ${user.user_id}: ${finalMatchedSkills.length} skills total.`
  );
}

/* -----------------------------
   MAIN PIPELINE
----------------------------- */
export async function normalizeUserSkills() {
  console.log("🚀 Starting AI-based user skill normalization...");

  const { data: users, error } = await supabase.from("user_information").select("*");
  if (error) throw error;

  console.log(`📦 Found ${users.length} users.`);

  // Initial dictionary
  let dbSkills = await fetchExistingSkills();

  // Process users in manageable batches
  for (let i = 0; i < users.length; i += CHUNK_SIZE) {
    const batch = users.slice(i, i + CHUNK_SIZE);
    for (const user of batch) {
      await processUser(user, dbSkills);
      await new Promise((r) => setTimeout(r, 300)); // small delay to avoid rate limiting
    }

    // Refresh dictionary after each batch
    dbSkills = await fetchExistingSkills();
  }

  console.log("\n📊 TOKEN & COST SUMMARY");
  console.log(`Input tokens: ${totalInput}`);
  console.log(`Output tokens: ${totalOutput}`);
  console.log(`💰 Total cost: $${totalCost.toFixed(4)}`);
  console.log("🏁 User skill normalization complete!");
}


