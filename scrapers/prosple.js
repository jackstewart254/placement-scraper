require("dotenv").config();
const puppeteer = require("puppeteer-extra");
const Stealth = require("puppeteer-extra-plugin-stealth");
puppeteer.use(Stealth());
const supabase = require("../utils/supabase");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Decode the Base64 "url" parameter inside the Prosple apply link
 */
function decodeProspleUrl(href) {
  try {
    const urlParams = new URLSearchParams(href.split("?")[1]);
    const encodedUrl = urlParams.get("url");
    if (!encodedUrl) return null;

    return Buffer.from(encodedUrl, "base64").toString("utf-8");
  } catch (err) {
    console.error("❌ Failed to decode URL:", err.message);
    return null;
  }
}

async function scrapeProspleSearch(searchUrl) {
  console.log("Fetching existing jobs from Supabase...");

  // Fetch existing jobs to prevent duplicates
  const { data: existingJobs, error: fetchError } = await supabase
    .from("jobs")
    .select("url");

  if (fetchError) {
    console.error("Error fetching existing jobs:", fetchError.message);
    return;
  }

  const existingUrls = new Set(existingJobs.map((job) => job.url));
  console.log(`Fetched ${existingUrls.size} existing jobs from Supabase.`);

  // Launch Puppeteer with defined viewport
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
    defaultViewport: {
      width: 2200,
      height: 1200,
    },
  });

  const page = await browser.newPage();
  await page.goto(searchUrl, { waitUntil: "networkidle2" });
  console.log("Navigated to Prosple search page.");

  const listSelector = "li.sc-3bbad5b8-1";
  const nextButtonSelector = 'button[aria-label="Goto next page"]';
  const loaderSelector = ".sc-bYutwE";
  const readMoreButtonSelector =
    'button[data-event-track="view-all-opportunity-description"]';
  const modalSelector = 'div[role="dialog"][data-state="open"]';
  const modalDescriptionSelector = `${modalSelector} [data-testid="raw-html"]`;
  const applyButtonSelector = 'a[data-event-track="cta-apply"]'; // ✅ real apply button

  let pageNum = 1;

  while (true) {
    console.log(`\n--- Scraping Page ${pageNum} ---`);
    await page.waitForSelector(listSelector, { visible: true });

    const jobCount = await page.$$eval(listSelector, (items) => items.length);
    console.log(`Found ${jobCount} job listings on page ${pageNum}.`);

    for (let index = 0; index < jobCount; index++) {
      console.log(
        `Processing job ${index + 1} of ${jobCount} on page ${pageNum}...`
      );

      const jobElements = await page.$$(listSelector);
      const job = jobElements[index];

      if (!job) {
        console.warn(`Job at index ${index} not found. Skipping...`);
        continue;
      }

      try {
        await job.hover();
        await job.click();
      } catch (err) {
        console.warn(`Error clicking job ${index + 1}:`, err.message);
        continue;
      }

      await delay(800); // Wait for detail pane to load

      // ✅ Get "Read More" description
      const readMoreButton = await page.$(readMoreButtonSelector);
      let fullDescription = "";

      if (readMoreButton) {
        console.log("Opening full description modal...");
        await readMoreButton.click();

        await page.waitForSelector(modalSelector, { visible: true });
        console.log("Modal opened.");

        fullDescription = await page.$eval(
          modalDescriptionSelector,
          (el) => el.innerText.trim()
        );

        const closeButton = await page.$(`${modalSelector} button.sc-ljIkKL`);
        if (closeButton) {
          await closeButton.click();
          console.log("Modal closed.");
          await delay(500);
        }
      }

      // ✅ Extract apply button real URL
      let realUrl = null;
      try {
        await page.waitForSelector(applyButtonSelector, { timeout: 5000 });
        const applyHref = await page.$eval(applyButtonSelector, (el) =>
          el.getAttribute("href")
        );

        if (applyHref) {
          realUrl = decodeProspleUrl(applyHref);
          console.log(`Decoded employer URL: ${realUrl}`);
        } else {
          console.warn("⚠️ No apply button found, defaulting to Prosple URL.");
        }
      } catch {
        console.warn("⚠️ No apply button found, defaulting to Prosple URL.");
      }

      // ✅ Extract job data
      const jobData = await page.evaluate(
        (listSelector, index, fullDescription) => {
          const allListItems = document.querySelectorAll(listSelector);
          const li = allListItems[index];
          if (!li) return null;

          const safeText = (el, selector) =>
            el?.querySelector(selector)?.innerText.trim() || "";

          const jobTitleEl = li.querySelector("h2.sc-dOfePm a");
          const companyEl = li.querySelector("p.sc-692f12d5-5");
          const locationEl = li.querySelector("p.sc-692f12d5-15");
          const salaryEl = li.querySelector(".sc-692f12d5-20");
          const startDateEl = li.querySelector(".sc-692f12d5-24 .field-item");
          const closingEl = li.querySelector('[data-testid="badge"] span');

          const roles = Array.from(li.querySelectorAll(".sc-692f12d5-30 span"))
            .map((span) => span.innerText.trim())
            .filter(Boolean);

          return {
            title: jobTitleEl?.innerText.trim() || "",
            company: companyEl?.innerText.trim() || "",
            location: locationEl?.innerText.trim() || "",
            salary: salaryEl?.innerText.trim() || "",
            startDate: startDateEl?.innerText.trim() || "",
            closingInfo: closingEl?.innerText.trim() || "",
            roles,
            description: fullDescription || "",
          };
        },
        listSelector,
        index,
        fullDescription
      );

      if (!jobData) {
        console.warn("Failed to scrape job data. Skipping...");
        continue;
      }

      // ✅ Decide which URL to save (real employer > Prosple)
      const finalUrl = realUrl || searchUrl;
      if (existingUrls.has(finalUrl)) {
        console.log(`Skipping existing job: ${jobData.title}`);
        continue;
      }

      try {
        // Check if company exists
        const { data: existingCompany, error: companyFetchError } =
          await supabase
            .from("companies")
            .select("id, name")
            .eq("name", jobData.company)
            .maybeSingle();

        let companyId;

        if (companyFetchError) {
          console.error("Error fetching company:", companyFetchError.message);
          continue;
        }

        if (existingCompany) {
          companyId = existingCompany.id;
          console.log(`Company found: ${existingCompany.name} (ID: ${companyId})`);
        } else {
          console.log(`Company not found. Inserting: ${jobData.company}`);

          const { data: insertedCompany, error: insertError } = await supabase
            .from("companies")
            .insert([{ name: jobData.company }])
            .select("id")
            .single();

          if (insertError) {
            console.error("Error inserting new company:", insertError.message);
            continue;
          }

          companyId = insertedCompany.id;
          console.log(`Inserted new company: ${jobData.company} (ID: ${companyId})`);
        }

        // Insert job with real employer URL
const jobRecord = {
  job_title: jobData.title,
  company_id: companyId,
  start_date: jobData.startDate,
  location: jobData.location,
  description: jobData.description,
  url: finalUrl, // decoded real employer URL
  benefits: jobData.benefits || "",
  created_at: new Date().toISOString(), // optional, may be auto-managed
  updated_at: new Date().toISOString(), // optional, may be auto-managed
};

const { error: insertError } = await supabase.from("jobs").insert([jobRecord]);

if (insertError) {
  console.error("Insert error:", insertError.message);
} else {
  console.log(`Inserted new job: ${jobRecord.job_title}`);
  existingUrls.add(finalUrl);
}

      } catch (err) {
        console.error("Unexpected error inserting job:", err.message);
      }

      await delay(1200);
    }

    // Pagination
    const nextButton = await page.$(nextButtonSelector);
    if (!nextButton) {
      console.log("No more pages found. Finished scraping.");
      break;
    }

    console.log(`Moving to page ${pageNum + 1}...`);
    await nextButton.click();

    try {
      await page.waitForSelector(loaderSelector, {
        visible: true,
        timeout: 5000,
      });
      console.log("Loader appeared.");
    } catch {
      console.warn("Loader did not appear, continuing...");
    }

    try {
      await page.waitForSelector(loaderSelector, {
        hidden: true,
        timeout: 15000,
      });
      console.log("Loader finished, next page loaded.");
    } catch {
      console.warn("Loader did not disappear in time, continuing anyway...");
    }

    await page.waitForSelector(listSelector, { visible: true });
    await delay(800);

    pageNum++;
  }

  await browser.close();
  console.log("All pages scraped successfully.");
}

module.exports = { scrapeProspleSearch };
