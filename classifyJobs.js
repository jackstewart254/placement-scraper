require("dotenv").config();

const OpenAI = require("openai");
const supabase = require("./utils/supabase");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function classifyJobs() {
  try {
    console.log("Fetching categories from database...");

    // 1. Fetch valid categories from the database
    const { data: categories, error: categoryError } = await supabase
      .from("categories")
      .select("id, name");

    if (categoryError) throw categoryError;

    if (!categories.length) {
      console.error("❌ No categories found in the database.");
      return;
    }

    console.log(`✅ Fetched ${categories.length} categories.`);
    const categoryList = categories.map((cat) => cat.name);

    console.log("Fetching jobs that need classification...");

    // 2. Fetch jobs that have BOTH job_type and category missing
    const { data: jobs, error: jobError } = await supabase
      .from("jobs")
      .select("id, job_title, description")
      .or("category.is.null,category.eq.''") // category null or empty
      .or("job_type.is.null,job_type.eq.''"); // job_type null or empty

    if (jobError) throw jobError;

    if (!jobs.length) {
      console.log("No jobs found needing classification.");
      return;
    }

    console.log(`✅ Found ${jobs.length} jobs to classify.`);

    // 3. Loop through jobs and classify them
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];

      // Progress display
      console.log(`\n[${i + 1}/${jobs.length}] Classifying job: ${job.job_title}`);

      // Build AI prompt
      const prompt = `
      You are a job classification assistant.

      Based on the job title and description provided:
      - Determine the **job_type** → exactly one of: "internship", "placement", or "clerkship".
      - Determine the **category** → choose the SINGLE most relevant value from this list:
        ${categoryList.join(", ")}

      Return ONLY JSON in this exact format:
      {
        "job_type": "placement",
        "category": "Technology"
      }

      Job Title: ${job.job_title}
      Job Description: ${job.description}
      `;

      try {
        // 4. Send to OpenAI
        const completion = await openai.chat.completions.create({
          model: "gpt-4.1-mini",
          messages: [{ role: "system", content: prompt }],
          temperature: 0,
        });

        const result = completion.choices[0].message.content.trim();

        let parsed;
        try {
          parsed = JSON.parse(result);
        } catch (err) {
          console.error(`❌ Failed to parse JSON for job "${job.job_title}":`, result);
          continue;
        }

        const { job_type, category } = parsed;

        // 5. Validate job_type
        if (!["internship", "placement", "clerkship"].includes(job_type)) {
          console.error(`❌ Invalid job_type returned: ${job_type} for job ${job.job_title}`);
          continue;
        }

        // 6. Validate category
        if (!categoryList.includes(category)) {
          console.error(`❌ Invalid category returned: ${category} for job ${job.job_title}`);
          continue;
        }

        // 7. Update job in Supabase
        const { error: updateError } = await supabase
          .from("jobs")
          .update({
            job_type,
            category,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        if (updateError) {
          console.error(`❌ Error updating job ${job.id}:`, updateError.message);
        } else {
          console.log(
            `✅ Updated job ${job.id}: job_type = ${job_type}, category = ${category}`
          );
        }

        // Small delay to avoid rate limits
        await new Promise((res) => setTimeout(res, 500));
      } catch (err) {
        console.error(`❌ Error classifying job "${job.job_title}":`, err.message);
      }
    }

    console.log("\n🎉 Classification complete!");
  } catch (err) {
    console.error("Unexpected error:", err.message);
  }
}

classifyJobs();
