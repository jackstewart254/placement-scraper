const puppeteer = require("puppeteer");
const cheerio = require("cheerio");
const parseDates = require("./components/parseDates")

function extractJobs(html) {
  const $ = cheerio.load(html);
  const results = [];

  $("tr").each((i, row) => {
    // Skip header row
    if ($(row).find("th").length > 0) return;

    const cells = $(row).find("td");

    // Company selector
    const companyElement = $(cells).eq(1).find("a[href^='/company/']");
    const company = companyElement.text().trim();

    // Job title + external URL
    const jobElement = $(cells).eq(2).find("a[href^='http']");
    const jobTitle = jobElement.text().trim();
    const url = jobElement.attr("href")?.trim() || "";

    // Opening date
    const opened = $(cells).eq(3).text().trim();

    // CV, Cover Letter, Written Answers
    const cvRequired = $(cells).eq(6).text().trim();
    const coverLetterRequired = $(cells).eq(7).text().trim();
    const writtenAnswersRequired = $(cells).eq(8).text().trim();

    results.push({
      company,
      jobTitle,
      opened: parseDates(opened),
      url,
      cvRequired,
      coverLetterRequired,
      writtenAnswersRequired,
      category: "Tech"
    });
  });

  return results;
}

const fetchTechPlacements = async () => {
  const browser = await puppeteer.launch({
    headless: true, // set to false for debugging
    defaultViewport: null,
    args: ["--start-maximized"]
  });

  const page = await browser.newPage();


  await page.goto("https://app.the-trackr.com/uk-technology/industrial-placements", {
    waitUntil: "networkidle2"
  });

  console.log("Page loaded!");

  const html = await page.content();
  const trCount = (html.match(/<tr/g) || []).length;
  console.log("Number of <tr> tags found:", trCount);

  const jobs = extractJobs(html);

  await browser.close();

  return jobs
}

module.exports = fetchTechPlacements;

