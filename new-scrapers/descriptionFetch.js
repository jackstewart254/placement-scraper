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
  // 1. Ignore "Register Your Interest" jobs
  if (job.title.trim().startsWith("Register Your Interest")) {
    console.log(`⏭️ Skipping job: ${job.title}`);
    return; // don’t insert into DB
  }

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
  let cleanDescription = cheerio
    .load(jobData.description || "")
    .text()
    .trim();

  if (cleanDescription.startsWith(job.title)) {
    cleanDescription = cleanDescription.replace(job.title, "").trim();
  }

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

  // Extract job roles
  const roles = extractRoles($);
  const rolesStr = roles.join(", ");

  // Extract company name from the <a> tag
  const companyName = $("a.hover\\:underline").first().text().trim();

  let companyId = null;
  if (companyName) {
    const { data: existing, error: findErr } = await supabase
      .from("companies")
      .select("id")
      .eq("name", companyName)
      .maybeSingle();

    if (findErr) {
      console.error("⚠️ Company lookup failed:", findErr.message);
    }

    if (existing?.id) {
      companyId = existing.id;
    } else {
      const { data: inserted, error: insertErr } = await supabase
        .from("companies")
        .insert([{ name: companyName, new: true }])
        .select("id")
        .single();

      if (insertErr) {
        console.error("⚠️ Company insert failed:", insertErr.message);
      } else {
        companyId = inserted.id;
        console.log(`🏢 Inserted new company: ${companyName}`);
      }
    }
  }

  // ✅ Build record for processing table
  const record = {
    url: job.url,
    application_url: applyUrl || "",
    location: locations.filter(Boolean).join(", "),
    description: cleanDescription,
    job_title: job.title,
    company_id: companyId,
    deadline: parseDeadline(job.deadline),
    salary: job.salary || null,
    logo: job.logo || null,
    origin: "higherin",
    ready: false,
    roles: rolesStr,
  };

  // ✅ Insert into processing
  const { error } = await supabase.from("processing").insert([record]);
  if (error) {
    console.error("❌ Insert failed:", error.message, job.url);
  } else {
    console.log(`✅ Inserted job into processing: ${job.title}`);
  }
}

export async function scrapeJobDetails(jobs) {
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

      console.log("---");

      console.log(
        `⏱️ Job took ${(duration / 1000).toFixed(2)}s. ` +
          `Avg: ${(avg / 1000).toFixed(2)}s/job. ` +
          `~${minutes}m ${seconds}s remaining for ${remaining} jobs.`
      );

      console.log("---");

      await new Promise((r) => setTimeout(r, 1000)); // small delay
    } catch (err) {
      console.error(`⚠️ Failed job ${job.url}:`, err.message);
    }
  }

  console.log("✅ All jobs processed.");
}
