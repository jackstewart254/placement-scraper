require("dotenv").config();
const puppeteer = require("puppeteer-extra");
const Stealth = require("puppeteer-extra-plugin-stealth");
const OpenAI = require("openai");
const supabase = require("../utils/supabase");

puppeteer.use(Stealth());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Decode Base64 "url" parameter from the Prosple apply link */
function decodeProspleUrl(href) {
  try {
    if (!href || typeof href !== "string") return null;
    const qs = href.includes("?") ? href.split("?")[1] : "";
    const urlParams = new URLSearchParams(qs);
    const encodedUrl = urlParams.get("url");
    if (!encodedUrl) return null;
    return Buffer.from(encodedUrl, "base64").toString("utf-8");
  } catch (err) {
    console.error("❌ Failed to decode URL:", err.message);
    return null;
  }
}

/** AI: Classify job into placement/internship/clerkship */
async function classifyJob(title, description) {
  const prompt = `
You are a job classification assistant.

Based on the job title and description:
- Identify the job type: "placement", "internship", or "clerkship".
- ONLY return JSON.

Job Title: ${title}
Description: ${description}

Return JSON like this:
{
  "job_type": "placement"
}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      messages: [{ role: "system", content: prompt }],
    });

    return JSON.parse(response.choices[0].message.content.trim());
  } catch (err) {
    console.error("❌ AI classification error:", err.message);
    return null;
  }
}

/** AI: Format description into professional markdown */
async function formatDescription(description) {
  const prompt = `
Reformat the following job description to be professional, clear, and easy to read:
- Use '-' for bullet points
- Use **bold** for subheaders or section titles
- Remove extra whitespace or irrelevant info
- Maintain readability

Job Description:
${description}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      messages: [{ role: "system", content: prompt }],
    });

    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error("❌ AI formatting error:", err.message);
    return description;
  }
}

/** AI: Extract salary from description */
async function extractSalary(description) {
  const prompt = `
Identify if there is any salary information in the job description below.
Examples: "£25,000/year", "£10/hour", "Competitive", "Unpaid".

Return JSON:
{
  "salary": "£25,000/year"
}

If no salary is mentioned, return:
{
  "salary": null
}

Description:
${description}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      messages: [{ role: "system", content: prompt }],
    });

    return JSON.parse(response.choices[0].message.content.trim()).salary;
  } catch (err) {
    console.error("❌ AI salary extraction error:", err.message);
    return null;
  }
}

/** AI: Assign job category */
async function assignCategory(title, description, categories) {
  const prompt = `
You are a job categorization assistant.

Available categories:
${categories.join(", ")}

Based on the job title and description, choose the SINGLE most appropriate category from the list above.

Return ONLY JSON:
{
  "category": "Finance"
}

Title: ${title}
Description: ${description}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      messages: [{ role: "system", content: prompt }],
    });

    return JSON.parse(response.choices[0].message.content.trim()).category;
  } catch (err) {
    console.error("❌ AI category assignment error:", err.message);
    return null;
  }
}

async function scrapeAndProcessJobs(searchUrl) {
  console.log("Fetching existing jobs from Supabase (read-only)...");
  const { data: existingJobs, error: fetchError } = await supabase
    .from("jobs")
    .select("url");

  if (fetchError) {
    console.error("❌ Error fetching existing jobs:", fetchError.message);
    return;
  }

  const existingUrls = new Set(
    (existingJobs || []).map((j) => j.url).filter(Boolean)
  );
  console.log(`✅ Loaded ${existingUrls.size} existing employer URLs.`);

  // Fetch categories
  console.log("Fetching categories from Supabase...");
  const { data: categoryData, error: categoryError } = await supabase
    .from("categories")
    .select("name");

  if (categoryError || !categoryData) {
    console.error("❌ Failed to fetch categories:", categoryError?.message);
    return;
  }
  const categories = categoryData.map((c) => c.name);
  console.log(`✅ Loaded ${categories.length} categories.`);

  // Puppeteer
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
    defaultViewport: { width: 2200, height: 1200 },
  });

  const page = await browser.newPage();
  console.log("Opening Prosple search page...");
  await page.goto(searchUrl, { waitUntil: "networkidle2" });

  // Selectors
  const listSelector = "li.sc-3bbad5b8-1";
  const nextButtonSelector = 'button[aria-label="Goto next page"]';
  const loaderSelector = ".sc-bYutwE";
  const readMoreButtonSelector = 'button[data-event-track="view-all-opportunity-description"]';
  const modalSelector = 'div[role="dialog"][data-state="open"]';
  const modalDescriptionSelector = `${modalSelector} [data-testid="raw-html"]`;
  const applyButtonSelector = 'a[data-event-track="cta-apply"]';

  await page.waitForSelector(listSelector, { visible: true });
  await delay(1500);
  console.log("✅ Initial job list loaded.");

  let pageNum = 1;

  while (true) {
    console.log(`\n--- Scraping Page ${pageNum} ---`);

    const decodedUrls = await page.$$eval(applyButtonSelector, (links) =>
      links.map((link) => {
        const href = link.getAttribute("href") || "";
        const qs = href.includes("?") ? href.split("?")[1] : "";
        const params = new URLSearchParams(qs);
        const encoded = params.get("url");
        if (!encoded) return null;
        try {
          return atob(encoded);
        } catch {
          return null;
        }
      })
    );

    const jobCount = await page.$$eval(listSelector, (items) => items.length);
    console.log(`Found ${jobCount} job listings.`);

    for (let index = 0; index < jobCount; index++) {
  const cards = await page.$$(listSelector);
  const card = cards[index];
  if (!card) continue;

  // Extract job title, company, and location directly from the card
  const basic = await card.evaluate((li) => {
    const text = (sel) => li.querySelector(sel)?.innerText?.trim() || "";
    return {
      title: text("h2.sc-dOfePm a"),
      company: text("p.sc-692f12d5-5"),
      location: text("p.sc-692f12d5-15"),
    };
  });

  console.log(`Processing job ${index + 1} of ${jobCount}: ${basic.title || "Untitled"}`);

  // Extract and decode apply link for THIS job card
  const rawHref = await card.$eval('a[data-event-track="cta-apply"]', (a) => a.getAttribute("href")).catch(() => null);

  let decodedUrl = null;
  if (rawHref) {
    decodedUrl = decodeProspleUrl(rawHref);
  }

  if (!decodedUrl) {
    console.warn(`⚠️ No decoded employer URL for job: ${basic.title}`);
  }

  // Check against database
  if (decodedUrl && existingUrls.has(decodedUrl)) {
    console.log(`↩️  Existing job, skipping: ${basic.title} — ${decodedUrl}`);
    continue;
  }

  // Scroll into view and click to load details
  await card.evaluate((el) =>
    el.scrollIntoView({ behavior: "auto", block: "center" })
  );
  await delay(150);
  await card.click();
  await delay(600);

  // Now open description modal...
  let fullDescription = "";
  try {
    const readMoreBtn = await page.$(readMoreButtonSelector);
    if (readMoreBtn) {
      await readMoreBtn.click();
      await page.waitForSelector(modalSelector, { visible: true, timeout: 8000 });
      fullDescription = await page.$eval(modalDescriptionSelector, (el) =>
        el.innerText.trim()
      );
      const closeBtn =
        (await page.$(`${modalSelector} button[aria-label="Close"]`)) ||
        (await page.$(`${modalSelector} button.sc-ljIkKL`));
      if (closeBtn) await closeBtn.click();
      await delay(300);
    }
  } catch (err) {
    console.warn(`⚠️ Could not open/read description modal: ${err.message}`);
  }

  // AI Classification
  const classification = await classifyJob(basic.title, fullDescription);
  if (!classification || classification.job_type !== "placement") {
    console.log(`Skipping non-placement job: ${basic.title}`);
    continue;
  }

  // AI Formatting
  const formattedDescription = await formatDescription(fullDescription);

  // AI Salary Extraction
  const salary = await extractSalary(fullDescription);

  // AI Category Assignment
  const category = await assignCategory(basic.title, fullDescription, categories);

  // Final Job Object
  const finalJob = {
    title: basic.title,
    company: basic.company,
    location: basic.location,
    url: decodedUrl, // ✅ Now perfectly matched
    salary,
    category,
    description: formattedDescription,
  };

  console.log("\n--- NEW PLACEMENT JOB ---");
  console.log(finalJob);
  console.log("--------------------------\n");

  await delay(400);
}

    // Pagination
    const nextBtn = await page.$(nextButtonSelector);
    if (!nextBtn) {
      console.log("✅ No more pages found. Scraping complete.");
      break;
    }

    console.log(`Moving to page ${pageNum + 1}...`);
    await nextBtn.click();

    try {
      await page.waitForSelector(loaderSelector, { visible: true, timeout: 5000 }).catch(() => {});
      await page.waitForSelector(loaderSelector, { hidden: true, timeout: 15000 }).catch(() => {});
      await delay(1200);
      console.log("✅ Next page loaded and stabilized.");
    } catch {
      console.warn("⚠️ Pagination wait timed out; continuing anyway.");
      await delay(1500);
    }

    pageNum++;
  }

  await browser.close();
  console.log("🎉 Finished scraping (log-only).");
}

module.exports = scrapeAndProcessJobs;
