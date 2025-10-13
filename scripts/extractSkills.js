import OpenAI from "openai";
import "dotenv/config";
import fetchDescriptions from "../hooks/fetchDescriptions.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o-mini";

/**
 * @param {Array<{processing_id: string, description: string}>} items
 * @returns {Promise<Array<{processing_id: string, skill: string, required: boolean}>>}
 */
export async function extractSkills(items) {
  const results = [];

  for (const item of items) {
    const prompt = `
You are an information extraction engine.
Read the following job description and extract every **distinct skill** mentioned.
For each skill, determine if it is *required* (essential for the role) or *optional* (nice to have).

Return valid JSON only in this format:
{
  "skills": [
    { "skill": "Skill Name", "required": true },
    { "skill": "Skill Name", "required": false }
  ]
}

Job description:
"""${item.description}"""
`;

    try {
      const completion = await openai.chat.completions.create({
        model: MODEL,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You extract professional skills and whether they are required or optional. Return valid JSON only.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 1000,
      });

      // Clean and parse output
      const output = completion.choices[0].message.content.trim();
      const cleaned = output.replace(/```json|```/g, "").trim();

      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (err) {
        console.error("⚠️ JSON parse failed for processing_id:", item.processing_id);
        parsed = { skills: [] };
      }

      // Build results
      for (const s of parsed.skills || []) {
        results.push({
          processing_id: item.processing_id,
          skill: s.skill,
          required: !!s.required,
        });
      }
    } catch (error) {
      console.error("❌ Error extracting skills for:", item.processing_id, error.message);
    }
  }

  return results;
}

const runExtractSkills = async () => {
  const desc = await fetchDescriptions()
  console.log(desc.slice(0,3))
}

export default runExtractSkills