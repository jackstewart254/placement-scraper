// scripts/normalizeLocations.js
import OpenAI from "openai";
import supabase from "../utils/supabase.js";
import formatDescription from "../components/descriptionFormatter.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 🔹 Prompt builders
const locationPrompt = (location) => `
You are cleaning and standardizing job locations for a UK-based job database.

Rules:
- Each location must return a hierarchy: [City, Region, Country].
- City → The specific city or town, e.g., "Birmingham"
- Region → The larger administrative area, e.g., "West Midlands"
- Country → Always "United Kingdom"
- If there are multiple cities, merge them together with their regions and only one "United Kingdom" at the end.

Examples:
"Birmingham" → "Birmingham, West Midlands, United Kingdom"
"London" → "London, Greater London, United Kingdom"
"Birmingham, London" → "Birmingham, London, West Midlands, Greater London, United Kingdom"
"Filton, Bristol" → "Filton, Bristol, South West England, United Kingdom"

Return only valid JSON mapping the original location to its standardized string.

Location to clean:
${JSON.stringify([location])}
`;

export default async function normaliseLocations() {
  console.log("Fetching processing records...");

  const { data: records, error } = await supabase
    .from("processing")
    .select("id, location, description")
    .eq("ready", false);



  if (error) {
    console.error("Error fetching processing records:", error.message);
    return;
  }

  if (!records?.length) {
    console.log("No records found.");
    return;
  }

  console.log(`Found ${records.length} records.`);

  // 🔹 Arrays to track times
  const locationTimes = [];
  const descriptionTimes = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    console.log(
      `\n⚙️ Processing record ID ${record.id} (${i + 1}/${records.length})...`
    );

    let newLocation = record.location;
    let formattedDescription = record.description;

    // Track location time
    const locationStart = Date.now();
    if (record.location) {
      try {
        const locCompletion = await openai.chat.completions.create({
          model: "gpt-4.1-mini",
          messages: [
            {
              role: "system",
              content:
                "You are a data cleaning assistant. Always output ONLY valid JSON, no commentary, no markdown.",
            },
            {
              role: "user",
              content: locationPrompt(record.location),
            },
          ],
          temperature: 0,
        });

        let rawLocOutput = locCompletion.choices[0].message.content.trim();
        if (rawLocOutput.startsWith("```")) {
          rawLocOutput = rawLocOutput.replace(/```json|```/g, "").trim();
        }

        const parsed = JSON.parse(rawLocOutput);
        newLocation = parsed[record.location] || record.location;
      } catch (err) {
        console.error(
          `❌ Location normalization failed for ID ${record.id}:`,
          err.message
        );
      }
    }
    const locationEnd = Date.now();
    const locationDuration = locationEnd - locationStart;
    locationTimes.push(locationDuration);

    // Track description time
    const descStart = Date.now();
    if (record.description) {
      formattedDescription = await formatDescription(record.description);
    }
    const descEnd = Date.now();
    const descriptionDuration = descEnd - descStart;
    descriptionTimes.push(descriptionDuration);

    const { error: updateError } = await supabase
      .from("processing")
      .update({
        location: newLocation,
        description: formattedDescription,
        ready: true,
        updated_at: new Date(),
      })
      .eq("id", record.id);

    if (updateError) {
      console.error(
        `❌ Failed to update record ${record.id}:`,
        updateError.message
      );
    } else {
      console.log(`✅ Updated record ${record.id}`);
    }

    // 🔹 Show time stats
    const locMean =
      locationTimes.reduce((a, b) => a + b, 0) / locationTimes.length;
    const descMean =
      descriptionTimes.reduce((a, b) => a + b, 0) / descriptionTimes.length;

    const remaining = records.length - (i + 1);
    const etaMs = remaining * (locMean + descMean);

    console.log(`Location took: ${(locationDuration / 1000).toFixed(2)}s`);
    console.log(
      `Description took: ${(descriptionDuration / 1000).toFixed(2)}s`
    );
    console.log(
      `⏱️ Avg Location: ${(locMean / 1000).toFixed(2)}s | Avg Description: ${(
        descMean / 1000
      ).toFixed(2)}s`
    );
    console.log(
      `🕒 Estimated time remaining: ${(etaMs / 1000).toFixed(2)}s (${(
        etaMs / 60000
      ).toFixed(2)} mins)`
    );
  }

  console.log("\n🎉 Finished processing all records.");
}
