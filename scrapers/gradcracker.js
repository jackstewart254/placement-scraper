const { startBrowser } = require("../utils/puppeteer");
const supabase = require("../utils/supabase");

async function scrapeGradcrackerJobs() {
  const { browser, page } = await startBrowser();

  await page.goto("https://www.gradcracker.com/search/jobs", {
    waitUntil: "domcontentloaded",
  });

  const jobLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a.job-title")).map(
      (a) => a.href
    );
  });

  console.log(`Found ${jobLinks.length} jobs`);

  for (const url of jobLinks) {
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const job = await page.evaluate(() => {
      const title = document.querySelector("h1")?.innerText || "";
      const company = document.querySelector(".employer-name")?.innerText || "";
      const location = document.querySelector(".location")?.innerText || "";
      const description =
        document.querySelector(".job-description")?.innerText || "";

      return { title, company, location, description };
    });

    const { error } = await supabase.from("jobs").insert([
      {
        job_title: job.title,
        company_name: job.company,
        location: job.location,
        description: job.description,
        url,
        source: "gradcracker",
      },
    ]);

    if (error) {
      console.error("Insert error:", error.message);
    } else {
      console.log(`Saved job: ${job.title}`);
    }
  }

  await browser.close();
}

module.exports = { scrapeGradcrackerJobs };
