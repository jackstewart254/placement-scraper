import fetch from "node-fetch";
import * as cheerio from "cheerio";
import supabase from "../utils/supabase.js"; // adjust path if needed
import parseDeadline from "../components/parseDeadlines.js";

/**
 * Scrapes the detail page of a job and inserts into "processing"
 * @param {object} job - job object from scrapeAllHigherInJobs
 * @param {number} index - index for debugging
 */
export async function scrapeJobDetail(job) {
  console.time(`⏱️ scrapeJobDetail ${job.url}`);

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
    console.timeEnd(`⏱️ scrapeJobDetail ${job.url}`);
    throw new Error("❌ Could not find JSON-LD on page");
  }

  let jobData;
  try {
    jobData = JSON.parse(ldJson);
  } catch (err) {
    console.error("⚠️ JSON parse failed:", ldJson.slice(0, 500));
    console.timeEnd(`⏱️ scrapeJobDetail ${job.url}`);
    throw err;
  }

  // Clean description
  const cleanDescription = cheerio.load(jobData.description || "").text().trim();

  // Extract location(s)
  let locations = [];
  if (Array.isArray(jobData.jobLocation)) {
    locations = jobData.jobLocation.map(
      (loc) => loc.address?.addressLocality || ""
    );
  } else if (jobData.jobLocation) {
    locations = [jobData.jobLocation.address?.addressLocality || ""];
  }

  // Extract application link
  let applyUrl = jobData.applicationContact?.url || null;
  if (!applyUrl) {
    const redirectAttr = $("job-redirect-modal").attr("url");
    if (redirectAttr) {
      const params = new URLSearchParams(redirectAttr.split("?")[1]);
      applyUrl = params.get("url") || "";
    }
  }

  console.timeEnd(`⏱️ scrapeJobDetail ${job.url}`);

  // Build record for processing table
  const record = {
    url: job.url,
    application_url: applyUrl || "",
    location: locations.filter(Boolean).join(", "),
    description: cleanDescription,
    job_title: job.title,
    company_id: job.company_id || null, // make sure your job objects have this
    deadline: parseDeadline(job.deadline),
    salary: job.salary || null,
    logo: job.logo || null,
    origin: "higherin", // or whatever you want to track
    ready: false,
  };

  // Insert into Supabase
  const { error } = await supabase.from("processing").insert([record]);
  if (error) {
    console.error("❌ Insert failed:", error.message);
  } else {
    console.log(`✅ Inserted job into processing: ${job.title}`);
  }
}

export async function scrapeJobDetails(jobs) {
  if (!jobs.length) {
    console.log("⚠️ No jobs to scrape.");
    return;
  }

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    console.log(`🔎 Processing job (${i + 1}/${jobs.length}): ${job.title}`);

    try {
      await scrapeJobDetail(job);
      await new Promise((r) => setTimeout(r, 1000)); // delay
    } catch (err) {
      console.error(`⚠️ Failed job ${job.url}:`, err.message);
    }
  }
}
