// scripts/normalizeLocations.js
require("dotenv").config();
const OpenAI = require("openai");
const supabase = require("./utils/supabase");

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function normalizeLocationsHierarchical() {
  console.log("Fetching jobs...");

  // 1. Fetch jobs
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, location")
    .eq("displayable", false);

  if (error) {
    console.error("Error fetching jobs:", error.message);
    return;
  }

  if (!jobs.length) {
    console.log("No jobs found.");
    return;
  }

  console.log(`Found ${jobs.length} jobs.`);

  // 2. Extract unique locations
  const uniqueLocations = Array.from(
    new Set(jobs.map(job => job.location).filter(Boolean))
  );

  console.log(`Unique locations found: ${uniqueLocations.length}`);

  // 3. Build prompt for OpenAI
  const prompt = `
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

  Return only valid JSON mapping each original location to its standardized string.
  
  Locations to clean:
  ${JSON.stringify(uniqueLocations)}
  `;

  // 4. Call OpenAI
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1",
    messages: [
      { role: "system", content: "You are a data cleaning assistant that outputs valid JSON only." },
      { role: "user", content: prompt },
    ],
    temperature: 0,
  });

  const rawOutput = completion.choices[0].message.content;

  let cleanedMapping;
  try {
    cleanedMapping = JSON.parse(rawOutput);
  } catch (e) {
    console.error("Failed to parse OpenAI output as JSON:", rawOutput);
    return;
  }

  console.log("AI Normalized Mapping:", cleanedMapping);

  // 5. Update Supabase
  console.log("Updating jobs in Supabase...");
  for (const job of jobs) {
    const newLocation = cleanedMapping[job.location];

    if (!newLocation || newLocation === job.location) continue;

    console.log(`Updating Job ID ${job.id}: ${job.location} → ${newLocation}`);

    const { error: updateError } = await supabase
      .from("jobs")
      .update({
        location: newLocation,
        displayable: true,
      })
      .eq("id", job.id);

    if (updateError) {
      console.error(`Failed to update job ${job.id}:`, updateError.message);
    }
  }

  console.log("Location hierarchy normalization complete!");
}


module.exports = normalizeLocationsHierarchical;
