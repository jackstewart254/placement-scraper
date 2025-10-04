import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function formatDescription(description) {
  if (!description || !description.trim()) return "";
  const prompt = `
Rewrite the job description into clean, structured Markdown. 
Preserve ALL relevant details, including company-specific information, training details, or notes that may not fit into standard categories. 

Guidelines:
- Use clear **bold** sub-headers (e.g., **Overview**, **Responsibilities**, **Requirements**, **Skills**, **Benefits**, **Training**, **Other Information**, **How to Apply**) 
- If a section doesn’t exist in the original, omit it.
- If content doesn’t fit into a standard section, place it under **Additional Information** (don’t delete it).
- Use '-' for bullet points where appropriate.
- Remove only true duplicates, filler words, or irrelevant noise (e.g., “apply now button below”).
- Keep sentences concise, but do not remove important content.

Return ONLY the cleaned Markdown.

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
