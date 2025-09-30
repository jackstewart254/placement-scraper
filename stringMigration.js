require("dotenv").config();
const supabase = require("./utils/supabase");
const OpenAI = require("openai");

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Uses OpenAI to intelligently parse raw text into structured JSON
 * Each item will have { title, description }
 */
async function cleanWithAI(rawText, type) {
  if (!rawText || typeof rawText !== "string") return [];

  console.log(`Cleaning ${type} text with OpenAI...`);

  const prompt = `
You are given a block of text representing a list of ${type}.  
Each item should be structured into JSON with:
- A **title** (short name of the activity or project)
- A **description** (one or more sentences describing it)

The text may contain irregular formatting, newlines, or commas.  
Your task is to carefully identify each ${type} and output **valid JSON only**, 
no extra commentary or explanation.

Example output:
[
  { "title": "Portfolio Website", "description": "A personal project to showcase my work using React and TailwindCSS." },
  { "title": "Banking Web Application", "description": "Built using Laravel with a MySQL database to manage users and accounts." }
]

Here is the raw text to clean:
---
${rawText}
---
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4.1",
    messages: [
      { role: "system", content: "You are a strict data cleaning assistant. Output ONLY valid JSON, no extra text." },
      { role: "user", content: prompt },
    ],
    temperature: 0,
  });

  const rawOutput = response.choices[0].message.content;

  try {
    return JSON.parse(rawOutput);
  } catch (err) {
    console.error(`Error parsing OpenAI response for ${type}:`, err.message);
    console.log("OpenAI Raw Output:", rawOutput);
    return [];
  }
}

/**
 * Migration script to process and update all user_information rows
 */
async function migrateUserInformation() {
  console.log("Fetching all user_information records...");

  const { data: users, error } = await supabase
    .from("user_information")
    .select("user_id, personal_projects, extra_curriculars");

  if (error) {
    console.error("Error fetching data:", error.message);
    process.exit(1);
  }

  console.log(`Found ${users.length} records.`);

  for (const user of users) {
    const { id, user_id, personal_projects, extra_curriculars } = user;

    let hasChanges = false;
    let cleanedPersonalProjects = [];
    let cleanedExtraCurriculars = [];

    // ---- Clean Personal Projects ----
    if (personal_projects && personal_projects.trim() !== "") {
      cleanedPersonalProjects = await cleanWithAI(personal_projects, "personal projects");
      if (cleanedPersonalProjects.length > 0) {
        hasChanges = true;
      } else {
        console.warn(`Failed to clean personal_projects for user_id ${user_id}`);
      }
    }

    // ---- Clean Extra Curriculars ----
    if (extra_curriculars && extra_curriculars.trim() !== "") {
      cleanedExtraCurriculars = await cleanWithAI(extra_curriculars, "extra curricular activities");
      if (cleanedExtraCurriculars.length > 0) {
        hasChanges = true;
      } else {
        console.warn(`Failed to clean extra_curriculars for user_id ${user_id}`);
      }
    }

    // ---- Skip update if no changes ----
    if (!hasChanges) {
      console.log(`No changes for user_id ${user_id}`);
      continue;
    }

    // ---- Update Supabase ----
    console.log(`Updating database for user_id ${user_id}...`);

    const { error: updateError } = await supabase
      .from("user_information")
      .update({
        personal_projects: cleanedPersonalProjects.length
          ? JSON.stringify(cleanedPersonalProjects)
          : personal_projects,
        extra_curriculars: cleanedExtraCurriculars.length
          ? JSON.stringify(cleanedExtraCurriculars)
          : extra_curriculars,
      })
      .eq("user_id", user_id);

    if (updateError) {
      console.error(`Error updating user_id ${user_id}:`, updateError.message);
    } else {
      console.log(`Successfully updated user_id ${user_id}`);
    }
  }

  console.log("Migration complete!");
}

migrateUserInformation();
