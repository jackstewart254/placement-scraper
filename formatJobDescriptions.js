require("dotenv").config();

const OpenAI = require("openai");
const supabase = require("./utils/supabase");

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function formatJobDescriptions() {
  try {
    console.log("Fetching jobs from database...");

    // 1. Fetch ALL jobs
    const { data: jobs, error: fetchError } = await supabase
      .from("jobs")
      .select("id, job_title, description")
      .range(0, 5000)

    if (fetchError) {
      throw new Error(`Error fetching jobs: ${fetchError.message}`);
    }

    if (!jobs || jobs.length === 0) {
      console.log("No jobs found in database.");
      return;
    }

    console.log(`✅ Found ${jobs.length} jobs to process.`);

    // 2. Loop through jobs
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      console.log(`\n[${i + 1}/${jobs.length}] Formatting description for job: ${job.job_title}`);

      // Skip if description is empty
      if (!job.description || job.description.trim() === "") {
        console.log("⚠️ No description found. Skipping...");
        continue;
      }

      // 3. Build prompt for OpenAI
      const prompt = `
You are a text formatter. 
Clean and format the following job description so that:
- Lists and responsibilities are converted into bullet points.
- Remove unnecessary line breaks and extra spaces.
- Make the text easy to read and cleanly formatted.

Return ONLY the formatted description without extra commentary.

Original description:
${job.description}
      `;

      try {
        // 4. Send to OpenAI
        const completion = await openai.chat.completions.create({
          model: "gpt-4.1-mini",
          messages: [{ role: "system", content: prompt }],
          temperature: 0,
        });

        const formattedDescription = completion.choices[0].message.content.trim();

        // Log preview
        console.log("Formatted description preview:\n", formattedDescription.slice(0, 200) + "...");

        // 5. Update Supabase
        const { error: updateError } = await supabase
          .from("jobs")
          .update({
            description: formattedDescription,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        if (updateError) {
          console.error(`❌ Error updating job ${job.id}:`, updateError.message);
        } else {
          console.log(`✅ Updated job ${job.id} with formatted description.`);
        }

        // Small delay to avoid hitting OpenAI rate limits
        await new Promise((res) => setTimeout(res, 500));
      } catch (err) {
        console.error(`❌ Error processing job ${job.id}:`, err.message);
      }
    }

    console.log("\n🎉 Finished formatting all job descriptions!");
  } catch (err) {
    console.error("Unexpected error:", err.message);
  }
}

formatJobDescriptions();
