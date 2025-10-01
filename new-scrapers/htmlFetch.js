import fetch from "node-fetch";
import * as cheerio from "cheerio";

function findPagination(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (obj.pagination) return obj.pagination;
  for (const key of Object.keys(obj)) {
    const found = findPagination(obj[key]);
    if (found) return found;
  }
  return null;
}

async function scrapeHigherIn(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  const html = await res.text();
  const $ = cheerio.load(html);

  const scriptTag = $('script:contains("__RMP_SEARCH_RESULTS_INITIAL_STATE__")')
    .first()
    .html();

  if (!scriptTag) {
    throw new Error("❌ Could not find job data script on the page.");
  }

  const start = scriptTag.indexOf("{");
  const end = scriptTag.lastIndexOf("}") + 1;
  const jsonText = scriptTag.slice(start, end);

  let jobData;
  try {
    jobData = JSON.parse(jsonText);
  } catch (err) {
    console.error("⚠️ JSON parse failed:\n", jsonText.slice(0, 500));
    throw err;
  }

  const jobs = jobData.data.map((job) => ({
    id: job.id,
    title: job.jobTitle,
    company: job.companyName,
    location: job.jobLocationNamesTrimmed,
    deadline: job.deadline,
    salary: job.salary,
    url: job.url,
    logo: job.smallLogo,
    origin: "Higherin",
  }));

  const pagination = findPagination(jobData) || {};

  return { jobs, pagination };
}

export async function scrapeAllHigherInJobs(present = []) {
  // Extract URLs from array of objects
  const presentSet = new Set(present.map((p) => p.url));

  const baseUrl = "https://higherin.com/search-jobs/placements";
  const firstPage = await scrapeHigherIn(baseUrl);

  const allJobs = firstPage.jobs.filter((job) => !presentSet.has(job.url));
  const totalPages = firstPage.pagination.lastPage || 1;

  console.log(`🔎 Found ${firstPage.jobs.length} jobs on page 1`);
  console.log(`📄 Total pages: ${totalPages}`);
  console.log(`🆕 New jobs from page 1: ${allJobs.length}`);

  for (let page = 2; page <= totalPages; page++) {
    const pageUrl = `${baseUrl}?page=${page}`;
    console.log(`➡️ Scraping page ${page} of ${totalPages}`);
    const { jobs } = await scrapeHigherIn(pageUrl);

    const newJobs = jobs.filter((job) => !presentSet.has(job.url));
    allJobs.push(...newJobs);

    console.log(`🆕 New jobs from page ${page}: ${newJobs.length}`);
  }

  console.log(`✅ Total new jobs scraped: ${allJobs.length}`);
  return allJobs;
}
