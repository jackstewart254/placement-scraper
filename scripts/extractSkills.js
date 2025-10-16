import OpenAI from "openai";
import "dotenv/config";
import fetchDescriptions from "../hooks/fetchDescriptions.js";
import supabase from "../utils/supabase.js";
import canonicalizeSkillName from "../components/unifyingSkills/canonicaliseNames.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

const PRICES = {
  "gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
};

export async function extractSkills(items) {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;

  const BATCH_SIZE = 5;         // OpenAI calls in parallel per chunk batch
  const FLUSH_AFTER = 10;       // ✅ flush after N completed jobs

  // Buffers for batched DB writes
  const logsBuffer = [];        // array of normalization_logs rows
  const completedBuffer = [];   // array of { processing_id, skills: [{...}, ...] }

  function chunkText(text, chunkSize = 1000) {
    const chunks = [];
    let current = "";
    const sentences = text.split(/(?<=[.?!])\s+/);
    for (const sentence of sentences) {
      if ((current + sentence).length > chunkSize) {
        if (current.trim()) chunks.push(current.trim());
        current = sentence;
      } else {
        current += " " + sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  async function flushBuffers() {
    if (completedBuffer.length === 0 && logsBuffer.length === 0) return;

    try {
      // 1) Gather all skills from completed jobs
      const allSkills = [];
      const jobIds = [];
      for (const { processing_id, skills } of completedBuffer) {
        jobIds.push(processing_id);
        if (skills?.length) allSkills.push(...skills);
      }

      if (allSkills.length) {
        await supabase.from("skills_extracted").insert(allSkills);
        console.log(`📚 Inserted ${allSkills.length} extracted skills for ${completedBuffer.length} jobs`);
      }

      // 2) Mark these jobs as extracted
      if (jobIds.length) {
        await supabase
          .from("descriptions")
          .update({ extracted: true })
          .in("processing_id", jobIds);
        console.log(`✅ Marked ${jobIds.length} jobs as extracted`);
      }

      // 3) Insert accumulated OpenAI usage logs
      if (logsBuffer.length) {
        await supabase.from("normalization_logs").insert(logsBuffer);
        console.log(`🧾 Inserted ${logsBuffer.length} usage log entries`);
      }

      // 4) Clear buffers
      completedBuffer.length = 0;
      logsBuffer.length = 0;
    } catch (err) {
      console.error("⚠️ Failed to flush buffers:", err.message);
      // (Optional) you can keep buffers intact for retry on next flush attempt
    }
  }

  let itemIndex = 0;
  let totalDuration = 0;

  for (const item of items) {
    const start = Date.now();
    console.log(`\n🧠 Description #: ${itemIndex + 1} / ${items.length}`);
    itemIndex++;

    const description = item.description || "";
    const chunks = chunkText(description, 1000);
    const uniqueSkills = new Set();
    const jobSkills = [];  // will be pushed into completedBuffer when job completes
    const jobLogs = [];    // usage logs for this job (will be merged into logsBuffer)

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);

      console.log(
        `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(chunks.length / BATCH_SIZE)} (${batch.length} chunks)`
      );

      const responses = await Promise.all(
        batch.map(async (chunk, batchIndex) => {
          const prompt = `
You are a professional information extraction engine that identifies **all learnable requirements** in job descriptions.
This includes not only explicit skills, but *anything that can be studied, practiced, trained, or achieved*.

Extract:
- Technical skills (e.g. Python, React, SQL, Machine Learning)
- Soft skills (e.g. communication, teamwork, problem-solving)
- Frameworks, tools, and technologies (e.g. AWS, Docker, TensorFlow)
- Certifications or courses (e.g. AWS Certified Developer, PRINCE2)
- Languages (e.g. English, Spanish, French)
- Any other learnable or developable requirement.

Ignore generic degree mentions such as “currently studying a degree” or “undergraduate student”.

Return strictly valid JSON ONLY in this format:
{
  "skills": [
    { "skill": "Skill Name" }
  ]
}

This is CHUNK ${i + batchIndex + 1}/${chunks.length} of the job description:
"""${chunk}"""
`;

          try {
            const completion = await openai.chat.completions.create({
              model: MODEL,
              temperature: 0,
              messages: [
                {
                  role: "system",
                  content: "You extract professional skills and return valid JSON only with 'skills' array.",
                },
                { role: "user", content: prompt },
              ],
              max_tokens: 1000,
            });

            const output = completion.choices[0].message.content.trim();
            const cleaned = output.replace(/```json|```/g, "").trim();
            const usage = completion.usage || {};

            const inputTokens = usage.prompt_tokens || 0;
            const outputTokens = usage.completion_tokens || 0;

            totalInput += inputTokens;
            totalOutput += outputTokens;

            const requestCost =
              inputTokens * PRICES[MODEL].input +
              outputTokens * PRICES[MODEL].output;
            totalCost += requestCost;

            // accumulate usage log rows (per request) for this job
            jobLogs.push({
              run_timestamp: new Date().toISOString(),
              model_used: MODEL,
              input_tokens: inputTokens,
              output_tokens: outputTokens,
              total_cost_usd: requestCost,
            });

            let parsed;
            try {
              parsed = JSON.parse(cleaned);
            } catch {
              console.error(
                `⚠️ JSON parse failed for processing_id ${item.processing_id}, chunk ${i + batchIndex + 1}:`,
                cleaned.slice(0, 200)
              );
              parsed = { skills: [] };
            }

            return parsed.skills || [];
          } catch (error) {
            console.error(
              `❌ Error extracting skills for processing_id ${item.processing_id}, chunk ${i + batchIndex + 1}:`,
              error.message
            );
            return [];
          }
        })
      );

      // collect unique skills for this job
      const batchSkills = responses.flat();
      for (const s of batchSkills) {
        const key = s.skill.toLowerCase().trim();
        if (!uniqueSkills.has(key)) {
          uniqueSkills.add(key);
          jobSkills.push({
            processing_id: item.processing_id,
            skill_text: s.skill.trim(),
            canonicalized: canonicalizeSkillName(s.skill.trim()),
          });
        }
      }
    }

    // ✅ Job completed: move its data into the global buffers
    if (jobLogs.length) logsBuffer.push(...jobLogs);
    completedBuffer.push({
      processing_id: item.processing_id,
      skills: jobSkills,
    });

    // Flush after every N completed jobs
    if (completedBuffer.length >= FLUSH_AFTER) {
      await flushBuffers();
    }

    const end = Date.now();
    const timeTaken = (end - start) / 1000;
    totalDuration += timeTaken;
    console.log(
      `✅ Completed description in ${timeTaken.toFixed(2)}s | Avg per description: ${(totalDuration / itemIndex).toFixed(
        2
      )} | Remaining: ${(((totalDuration / itemIndex) * (items.length - itemIndex)) / 60).toFixed(2)}m`
    );
  }

  // Final flush for any remainder
  await flushBuffers();

  console.log(`🏁 Extraction finished. Total cost: $${totalCost.toFixed(5)}`);
}

const runExtractSkills = async () => {
  const desc = await fetchDescriptions();
  await extractSkills(desc);
};

export default runExtractSkills;
