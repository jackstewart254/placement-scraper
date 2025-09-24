require("dotenv").config();

const OpenAI = require("openai");
const supabase = require("./utils/supabase");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function classifyJobs() {
  try {
    // 1. Fetch jobs without job_type or category
    const { data: jobs, error } = await supabase
      .from("jobs")
      .select("id, job_title, description")
      .range(20, 1000);


    if (error) throw error;
    if (!jobs.length) {
      console.log("No jobs found needing classification.");
      return;
    }

    console.log(`Found ${jobs.length} jobs to classify.`);

    for (const job of jobs) {
      console.log(`Classifying job: ${job.job_title}`);

      // 2. Send to OpenAI for classification
      const prompt = `
      You are a job classifier.
      Based on the provided job title and description, determine:

      1. job_type → must be exactly one of: "internship", "placement", or "clerkship".
      2. category → general field of the job, e.g., "Technology", "Finance", "Healthcare", "Engineering", etc.

      Return only JSON in this exact format:
      {
        "job_type": "placement",
        "category": "Technology"
      }

      Job Title: ${job.job_title}
      Description: ${job.description}
      `;

      const completion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [{ role: "system", content: prompt }],
        temperature: 0, // deterministic
      });

      const result = completion.choices[0].message.content;

      let parsed;
      try {
        parsed = JSON.parse(result);
      } catch (err) {
        console.error("Failed to parse JSON:", result);
        continue;
      }

      // 3. Update Supabase
      const { error: updateError } = await supabase
        .from("jobs")
        .update({
          job_type: parsed.job_type,
          category: parsed.category,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      if (updateError) {
        console.error(`Error updating job ${job.id}:`, updateError.message);
      } else {
        console.log(
          `Updated job ${job.id} → ${parsed.job_type}, ${parsed.category}`
        );
      }

      // Small delay to avoid rate limits
      await new Promise((res) => setTimeout(res, 500));
    }

    console.log("Classification complete.");
  } catch (err) {
    console.error("Unexpected error:", err.message);
  }
}

classifyJobs();
