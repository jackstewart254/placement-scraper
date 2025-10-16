import "dotenv/config";
import pkg from "hnswlib-node";
import fs from "fs";
import supabase from "../utils/supabase.js";
import fetchSkillVectors from "../hooks/selected/fetchSkillsVector.js";

const { HierarchicalNSW } = pkg;

const DIM = 1536;
const SIMILARITY_THRESHOLD = 0.7;
const TOP_K = 5;
const SAMPLE_LIMIT = 50000;

async function fetchVectors(limit = SAMPLE_LIMIT) {
  console.log("📦 Fetching vectors from Supabase...");
  const data = await fetchSkillVectors();

  // const { data } = await supabase
  //   .from("skills_vectors")
  //   .select("id, extracted_id, embedding");

  console.log(`✅ Loaded ${data.length} vectors`);
  return data.map((v) => ({
    ...v,
    embedding:
      typeof v.embedding === "string"
        ? JSON.parse(v.embedding)
        : v.embedding,
  }));
}

function buildANNIndex(vectors) {
  console.log("🏗️ Building ANN index...");
  const index = new HierarchicalNSW("cosine", DIM);
  index.initIndex(vectors.length);

  vectors.forEach((v, i) => {
    index.addPoint(v.embedding, i);
  });

  console.log("✅ ANN index built successfully");
  return index;
}

async function main() {
  const vectors = await fetchVectors();
  const index = buildANNIndex(vectors);

  console.log("\n🧮 Clustering similar skills...");
  const visited = new Set();
  const clusters = [];

  for (let i = 0; i < vectors.length; i++) {
    if (visited.has(i)) continue;

    const query = vectors[i].embedding;
    const result = index.searchKnn(query, TOP_K);
    const cluster = new Set([i]);
    visited.add(i); // mark representative immediately

    result.neighbors.forEach((idx, j) => {
      const similarity = 1 - result.distances[j];
      if (similarity >= SIMILARITY_THRESHOLD && !visited.has(idx)) {
        cluster.add(idx);
        visited.add(idx);
      }
    });

    clusters.push([...cluster]);
  }

  console.log(`✅ Found ${clusters.length} clusters`);

  console.log("\n💾 Inserting canonical skills...");
  const results = [];

  let clusterCount = 0;


for (const group of clusters) {
  if (group.length <= 1) continue; // skip singletons
  clusterCount++;
  console.log(`🌀 Processing cluster ${clusterCount}/${clusters.length} (size: ${group.length})`);

  const representative = vectors[group[0]];
  const repSkillId = representative.extracted_id;

  // --- Fetch representative skill text + processing_id ---
  const { data: repData, error: repError } = await supabase
    .from("skills_extracted")
    .select("skill_text, processing_id, canonicalized")
    .eq("id", repSkillId)
    .single();

  if (repError || !repData) {
    console.error("Error fetching representative skill:", repError);
    continue;
  }

  let name = repData.skill_text.trim();

  const words = name.split(/\s+/);
  if (words.length > 0 && words[0].length <= 4) {
    words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
    name = words.join(" ");
  }
  const canonicalized = repData.canonicalized.trim()

  const processingIds = [];

  for (const idx of group) {
    const extractedId = vectors[idx].extracted_id;

    const { data, error } = await supabase
      .from("skills_extracted")
      .select("processing_id")
      .eq("id", extractedId)
      .single();

    if (error) {
      console.error("Error fetching processing_id:", error);
      continue;
    }

    if (data?.processing_id) processingIds.push(data.processing_id);
  }

  // skip if only one processing_id
  if (processingIds.length <= 1) continue;

  // --- 🧠 Insert skill into `skills` table ---
  let skillRecord;

  const { data: insertedSkill, error: insertErr } = await supabase
    .from("skills")
    .insert({
      skill_name: name,
      canonicalized: canonicalized,
    })
    .select()
    .single();

  if (insertErr) {
    // handle unique constraint conflict gracefully
    if (insertErr.code === "23505") {
      const { data: existing, error: fetchErr } = await supabase
        .from("skills")
        .select("id")
        .eq("canonicalized", canonicalized)
        .single();

      if (fetchErr) {
        console.error("Failed to fetch existing skill:", fetchErr);
        continue;
      }
      skillRecord = existing;
    } else {
      console.error("Error inserting skill:", insertErr);
      continue;
    }
  } else {
    skillRecord = insertedSkill;
  }

  const skillId = skillRecord.id;

  // --- 🔗 Insert relationships into `skills_jobs` ---
  const uniqueProcessingIds = [...new Set(processingIds)];

  const jobLinks = uniqueProcessingIds.map((processing_id) => ({
    processing_id,
    skill_id: skillId,
  }));

  const { error: linkErr } = await supabase
    .from("skills_jobs")
    .upsert(jobLinks, { onConflict: "processing_id,skill_id" });

  if (linkErr) {
    console.error(`Error linking skill "${name}" to jobs:`, linkErr);
  } else {
    console.log(
      `✅ Inserted skill "${canonicalized}" linked to ${uniqueProcessingIds.length} processing rows`
    );
  }
}


  // const deduped = Object.values(
  //   results.reduce((acc, r) => {
  //     const key = r.name;
  //     if (!acc[key]) {
  //       acc[key] = { ...r };
  //     } else {
  //       // merge processing_id lists
  //       const merged = new Set([
  //         ...acc[key].processing_ids.split(","),
  //         ...r.processing_ids.split(","),
  //       ]);
  //       acc[key].processing_ids = Array.from(merged).join(",");
  //     }
  //     return acc;
  //   }, {})
  // );

  // // 🧹 Optional: log how many singletons were removed
  // const removedCount = clusters.length - deduped.length;
  // console.log(`🧹 Filtered out ${removedCount} singleton skills before export`);

  // // ✅ Ensure CSV directory exists
  // fs.mkdirSync("./csv", { recursive: true });

  // // ✅ Write output to CSV
  // const csvHeader = "skill_name,processing_ids\n";
  // const csvRows = deduped
  //   .map(
  //     (r) =>
  //       `"${r.name.replace(/"/g, '""')}","${r.processing_ids.replace(/"/g, '""')}"`
  //   )
  //   .join("\n");

  // fs.writeFileSync("./csv/dedupedSkills4.csv", csvHeader + csvRows);
  // console.log(
  //   `📄 Saved ${deduped.length} canonical skills with processing_id links to ./csv/dedupedSkills.csv`
  // );
}

export default main;
