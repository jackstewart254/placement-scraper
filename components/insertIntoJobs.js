// scripts/migrateProcessingToJobs.js
import supabase from "../utils/supabase.js";

export default async function migrateProcessingToJobs() {
  console.log("🔎 Fetching processing rows...");

  // 1. Fetch rows from processing where ready = true
  const { data: processingRows, error: processingError } = await supabase
    .from("processing")
    .select("*")
    .eq("ready", true);

  if (processingError) {
    console.error(
      "❌ Error fetching processing rows:",
      processingError.message
    );
    return;
  }

  if (!processingRows || processingRows.length === 0) {
    console.log("⚠️ No rows to migrate.");
    return;
  }

  console.log(`📦 Found ${processingRows.length} rows to migrate.`);

  for (const row of processingRows) {
    console.log(row.application_url);
    try {
      // 2. Check if job already exists in jobs table (by url)
      const { data: existingJob, error: checkError } = await supabase
        .from("jobs")
        .select("id, url")
        .eq("url", row.application_url)
        .maybeSingle();

      console.log(existingJob);

      if (checkError) {
        console.error(
          `⚠️ Failed to check existing job for ${row.application_url}:`,
          checkError.message
        );
        continue;
      }

      if (existingJob) {
        console.log(
          `⏭️ Skipping insert: job with url ${row.application_url} already exists (Job ID: ${existingJob.id})`
        );
        continue;
      }

      const { error: insertError } = await supabase.from("jobs").insert([
        {
          url: row.application_url,
          location: row.location,
          description: row.description,
          job_title: row.job_title,
          company_id: row.company_id,
          deadline: row.deadline,
          salary: row.salary,
          category: row.roles,
          ready: true,
          logo: row.logo,
        },
      ]);

      if (insertError) {
        console.error(
          `❌ Failed to insert job from processing ID ${row.id}:`,
          insertError.message
        );
        continue;
      }

      if (row.company_id && row.logo) {
        // Fetch current company logo
        const { data: company, error: fetchError } = await supabase
          .from("companies")
          .select("logo")
          .eq("id", row.company_id)
          .single();

        if (fetchError) {
          console.error(
            `⚠️ Failed to fetch company ${row.company_id}:`,
            fetchError.message
          );
        } else if (!company.logo) {
          // Only update if logo is missing/empty/null
          const { error: updateCompanyError } = await supabase
            .from("companies")
            .update({ logo: row.logo })
            .eq("id", row.company_id);

          if (updateCompanyError) {
            console.error(
              `⚠️ Failed to update company ${row.company_id}:`,
              updateCompanyError.message
            );
          } else {
            console.log(
              `🏢 Updated company ${row.company_id} logo → ${row.logo}`
            );
          }
        } else {
          console.log(
            `⏭️ Skipped company ${row.company_id}, logo already set.`
          );
        }
      }

      console.log(`✅ Migrated processing row ${row.id} → jobs.`);
    } catch (err) {
      console.error(`💥 Unexpected error on row ${row.id}:`, err.message);
    }
  }
  console.log(processingRows.length);

  console.log("🎉 Migration complete!");
}
