import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function formatDescription(description) {
  if (!description || !description.trim()) return "";
  const prompt = `
Rewrite the job description in clean Markdown:
- Use short sections with **bold** sub-headers (e.g., **Overview**, **Responsibilities**, **Requirements**, **Benefits**, **How to Apply**)
- Use '-' for bullet lists
- Remove noise and duplicate lines
- Keep facts accurate

Return ONLY the rewritten content.

Original:
${description}
`;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    });
    return completion.choices[0]?.message?.content?.trim() || description;
  } catch (err) {
    console.warn("⚠️ formatDescription failed:", err.message);
    return description;
  }
}