require("dotenv").config();
const puppeteer = require("puppeteer-extra");
const Stealth = require("puppeteer-extra-plugin-stealth");
puppeteer.use(Stealth());
const supabase = require("../utils/supabase");

// Simple delay helper
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function scrapeProspleSearch(searchUrl) {
  const browser = await puppeteer.launch({
    headless: false, // true for production
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
    defaultViewport: null,
  });

  const page = await browser.newPage();
  await page.goto(searchUrl, { waitUntil: "networkidle2" });

  console.log("Navigated to Prosple search page.");

  const listSelector = "li.sc-3bbad5b8-1";
  const nextButtonSelector = 'button[aria-label="Goto next page"]';
  const loadingSpinnerSelector = ".sc-dLFgTI svg"; // Loading spinner icon selector

  let pageNum = 1;

  while (true) {
    console.log(`\n--- Scraping Page ${pageNum} ---`);

    // Wait for jobs to load
    await page.waitForSelector(listSelector, { visible: true });

    // Get job count for current page
    const jobCount = await page.$$eval(listSelector, (items) => items.length);
    console.log(`Found ${jobCount} job listings on page ${pageNum}.`);

    // Scrape each job
    for (let index = 0; index < jobCount; index++) {
      console.log(
        `Processing job ${index + 1} of ${jobCount} on page ${pageNum}...`
      );

      // Re-fetch job elements fresh to avoid stale references
      const jobElements = await page.$$(listSelector);
      const job = jobElements[index];

      if (!job) {
        console.warn(`Job at index ${index} not found. Skipping...`);
        continue;
      }

      // Safely hover and click
      try {
        await job.hover();
        await job.click();
      } catch (err) {
        console.warn(`Error clicking job ${index + 1}:`, err.message);
        continue;
      }

      // Wait for the detail pane to load
      await delay(1000); // <-- Replaced page.waitForTimeout(1000)

      // Scrape summary + details
      const jobData = await page.evaluate(
        (listSelector, index) => {
          const safeText = (el, selector) =>
            el?.querySelector(selector)?.innerText.trim() || "";

          const allListItems = document.querySelectorAll(listSelector);
          const li = allListItems[index];
          if (!li) return null;

          // ----- LEFT PANE -----
          const jobTitleEl = li.querySelector("h2.sc-dOfePm a");
          const companyEl = li.querySelector("p.sc-692f12d5-5");
          const locationEl = li.querySelector("p.sc-692f12d5-15");
          const salaryEl = li.querySelector(".sc-692f12d5-20");
          const startDateEl = li.querySelector(".sc-692f12d5-24 .field-item");
          const closingEl = li.querySelector('[data-testid="badge"] span');

          const roles = Array.from(li.querySelectorAll(".sc-692f12d5-30 span"))
            .map((span) => span.innerText.trim())
            .filter(Boolean);

          const summary = {
            title: jobTitleEl?.innerText.trim() || "",
            relativeUrl: jobTitleEl?.getAttribute("href") || "",
            company: companyEl?.innerText.trim() || "",
            location: locationEl?.innerText.trim() || "",
            salary: salaryEl?.innerText.trim() || "",
            startDate: startDateEl?.innerText.trim() || "",
            closingInfo: closingEl?.innerText.trim() || "",
            roles,
          };

          // ----- RIGHT PANE -----
          const description =
            document
              .querySelector('[data-testid="raw-html"]')
              ?.innerText.trim() || "";

          const benefitLi = Array.from(
            document.querySelectorAll(".sc-58338662-2 li")
          ).find((li) => li.innerText.includes("Additional benefits"));
          const benefits =
            benefitLi?.querySelector("span.sc-58338662-5")?.innerText || "";

          const deadlineLi = Array.from(
            document.querySelectorAll(".sc-58338662-2 li")
          ).find((li) => li.innerText.includes("Apply by"));
          const deadline =
            deadlineLi
              ?.querySelector("span.sc-58338662-5")
              ?.innerText.replace("Apply by ", "") || "";

          const startDetailLi = Array.from(
            document.querySelectorAll(".sc-58338662-2 li")
          ).find((li) => li.innerText.includes("Start date"));
          const startDateDetail =
            startDetailLi
              ?.querySelector("span.sc-58338662-5")
              ?.innerText.replace("Start date ", "") || "";

          const industry =
            document.querySelector(".sc-7b9ae07d-7")?.innerText.trim() || "";

          const firstLi = document.querySelector(".sc-58338662-2 li");
          const jobType =
            firstLi?.querySelector("span.sc-58338662-5")?.innerText || "";

          return {
            ...summary,
            industry,
            description,
            benefits,
            deadline,
            startDateDetail,
            jobType,
          };
        },
        listSelector,
        index
      );

      if (!jobData) {
        console.warn("Failed to scrape job data. Skipping...");
        continue;
      }

      const fullUrl = "https://uk.prosple.com" + jobData.relativeUrl;
      console.log(`Scraped: ${jobData.title} (${fullUrl})`);

      // Delay between jobs to avoid detection
      await delay(1500); // <-- Replaced page.waitForTimeout(1500)
    }

    // ----- PAGINATION -----
    const nextButton = await page.$(nextButtonSelector);
    if (!nextButton) {
      console.log("No more pages found. Finished scraping.");
      break;
    }

    console.log(`Moving to page ${pageNum + 1}...`);

    // Click the next button and wait for new jobs to load
    await Promise.all([
      nextButton.click(),
      page.waitForNavigation({ waitUntil: "networkidle2" }),
    ]);

    // Wait for loading spinner to disappear
    try {
      await page.waitForSelector(loadingSpinnerSelector, {
        hidden: true,
        timeout: 10000,
      });
      console.log("Loading spinner gone, ready to scrape next page.");
    } catch {
      console.warn("Loading spinner did not disappear, continuing anyway...");
    }

    // Extra safety delay to ensure content has fully loaded
    await delay(2000);

    pageNum++;
  }

  await browser.close();
  console.log("All pages scraped successfully.");
}

module.exports = { scrapeProspleSearch };
