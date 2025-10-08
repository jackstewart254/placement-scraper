import supabase from "./utils/supabase.js";

export async function linkProcessingToJobs() {
  // 1️⃣ Fetch processing records
  const { data: processing, error: processingError } = await supabase
    .from("processing")
    .select("id, url, application_url");

  if (processingError) throw processingError;

  // 2️⃣ Fetch job URLs
  const { data: jobs, error: jobsError } = await supabase
    .from("jobs")
    .select("id, url")
    .eq('ready', true)

  if (jobsError) throw jobsError;

  // 3️⃣ Match them by URL and update each matching job
  for (const p of processing) {
    const matchingJob = jobs.find((j) => j.url === p.application_url);

    if (!matchingJob) continue; // skip if no match found

    // 4️⃣ Update the job with its corresponding processing_id
    const { error: updateError } = await supabase
      .from("jobs")
      .update({ processing_id: p.id })
      .eq("id", matchingJob.id);

    if (updateError) {
      console.error(
        `❌ Failed to update job ${matchingJob.id}: ${updateError.message}`
      );
    } else {
      console.log(
        `✅ Linked processing ${p.id} → job ${matchingJob.id}`
      );
    }
  }

  console.log("✅ All matching jobs updated.");
}

