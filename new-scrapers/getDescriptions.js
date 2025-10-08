import fetch from "node-fetch";
import * as cheerio from "cheerio";
import supabase from "../utils/supabase.js"; // adjust path if needed
import parseDeadline from "../components/parseDeadlines.js";
import extractRoles from "../components/extractRoles.js";

/**
 * Scrapes the detail page of a job and inserts into "processing"
 * @param {object} job - job object from scrapeAllHigherInJobs
 * @param {number} index - index for debugging
 */
export async function scrapeJobDetail(job) {
  console.log(job)
  // 1. Ignore "Register Your Interest" jobs

  const res = await fetch(job.url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!res.ok) {
    throw new Error(`❌ Failed to fetch ${job.url}: ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const ldJson = $('script[type="application/ld+json"]').html();
  if (!ldJson) {
    throw new Error("❌ Could not find JSON-LD on page");
  }

  let jobData;
  try {
    jobData = JSON.parse(ldJson);
  } catch (err) {
    console.error("⚠️ JSON parse failed:", ldJson.slice(0, 500));
    throw err;
  }

  // 2. Clean description (strip out job title if it’s at the top)
  let cleanDescription = $(jobData.description).text().trim();

  if (cleanDescription.startsWith(job.title)) {
    cleanDescription = cleanDescription.replace(job.title, "").trim();
  }

  // ✅ Build record for processing table
  const record = {
    processing_id: job.id,
    description: cleanDescription,
  };

  console.log(record)

  // ✅ Insert into processing
  const { error } = await supabase.from("descriptions").insert([record]);
  if (error) {
    console.error("❌ Insert failed:", error.message, job.url);
  } else {
    console.log(`✅ Inserted job into processing: ${job.title}`);
  }
}



export async function getDescriptions(jobs) {
  if (!jobs.length) {
    console.log("⚠️ No jobs to scrape.");
    return;
  }

  const durations = []; // keep track of scrape times

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    console.log(`🔎 Processing job (${i + 1}/${jobs.length}): ${job.title}`);

    const start = Date.now();

    try {
      await scrapeJobDetail(job);

      const duration = Date.now() - start;
      durations.push(duration);

      // Calculate mean time per job
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;

      // Remaining jobs
      const remaining = jobs.length - (i + 1);

      // Estimate total remaining time (in seconds)
      const remainingMs = avg * remaining;
      const minutes = Math.floor(remainingMs / 60000);
      const seconds = Math.floor((remainingMs % 60000) / 1000);
      
      console.log("---")

      console.log(
        `⏱️ Job took ${(duration / 1000).toFixed(2)}s. ` +
        `Avg: ${(avg / 1000).toFixed(2)}s/job. ` +
        `~${minutes}m ${seconds}s remaining for ${remaining} jobs.`
      );

      console.log("---")


      await new Promise((r) => setTimeout(r, 1000)); // small delay
    } catch (err) {
      console.error(`⚠️ Failed job ${job.url}:`, err.message);
    }
  }

  console.log("✅ All jobs processed.");
}

