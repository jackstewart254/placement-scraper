require("dotenv").config();
const puppeteer = require("puppeteer-extra");
const Stealth = require("puppeteer-extra-plugin-stealth");
const OpenAI = require("openai");
const supabase = require("./../utils/supabase");

puppeteer.use(Stealth());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/** ---------- UTILITIES ---------- **/

/** Decode the Base64 encoded apply link */
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

/** Convert raw date text into YYYY-MM-DD */
function parseDateFromText(text) {
  if (!text) return null;
  try {
    // Remove labels like "Apply by" or "Start date"
    const cleaned = text
      .replace(/Apply by/i, "")
      .replace(/Start date/i, "")
      .trim();

    const parsed = new Date(cleaned);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split("T")[0]; // yyyy-mm-dd
    }
  } catch (err) {
    console.warn("⚠️ Date parse failed:", err.message, "for text:", text);
  }
  return null;
}

/** Normalize salary to exactly one of: "£25,000/year", "£10/hour", "Competitive", "Unpaid" */
function normalizeSalary(text) {
  if (!text) return "Competitive";
  const lower = text.toLowerCase();

  // Explicit unpaid
  if (/\bunpaid\b/.test(lower)) return "Unpaid";

  // Currency patterns
  const moneyRegex = /£\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/g;
  let match;
  let best = null;

  while ((match = moneyRegex.exec(text)) !== null) {
    const raw = match[1].replace(/,/g, "");
    const val = parseFloat(raw);
    if (!isNaN(val)) {
      // Detect per-hour hints near the number window
      const windowStart = Math.max(0, match.index - 25);
      const windowEnd = Math.min(text.length, match.index + match[0].length + 25);
      const window = text.slice(windowStart, windowEnd).toLowerCase();

      const hourHint = /(per\s*hour|\/\s*hour|\bph\b|\b\/hr\b|\bper\s*hr\b|\bhourly\b)/.test(window);
      const yearHint = /(per\s*annum|\/\s*year|per\s*year|\bpa\b|\bp\.a\.\b|\bannual\b|\bannum\b)/.test(window);

      if (hourHint) {
        best = { kind: "hour", val };
        break;
      }
      if (yearHint) {
        best = { kind: "year", val };
        break;
      }

      // Heuristic by magnitude if ambiguous
      if (!best) {
        if (val <= 100) best = { kind: "hour", val };
        else if (val >= 1000) best = { kind: "year", val };
      }
    }
  }

  if (!best) return "Competitive";
  if (best.kind === "hour") return `£${Math.round(best.val)}/hour`;
  // Format annual with thousands separators
  const annual = Math.round(best.val).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `£${annual}/year`;
}

/** Heuristic classifier for job_type (overrides AI if clear) */
function classifyJobTypeHeuristic(title, description = "") {
  const t = (title || "").toLowerCase();
  const d = (description || "").toLowerCase();

  const isPlacement =
    /\bindustrial placement\b|\bplacement year\b|\byear in industry\b|\bsandwich year\b|\bplacement\b/.test(t) ||
    /\bindustrial placement\b|\bplacement year\b|\byear in industry\b|\bsandwich year\b|\bplacement\b/.test(d);

  const isInternship =
    /\binternship\b|\bintern\b|\bsummer internship\b/.test(t) ||
    /\binternship\b|\bintern\b|\bsummer internship\b/.test(d);

  const isClerkship =
    /\bclerkship\b/.test(t) || /\bclerkship\b/.test(d);

  if (isPlacement && !isInternship) return "placement"; // clear placement signal
  if (isClerkship) return "clerkship";
  if (isInternship && !isPlacement) return "internship"; // clear internship signal
  return "unknown"; // ambiguous
}

/** AI fallback for classification + category */
async function classifyWithAI(jobTitle, description, categories) {
  const prompt = `
You classify roles from title + description.

Return ONLY JSON:
{
  "job_type": "internship" | "placement" | "clerkship",
  "category": "<one of: ${categories.join(", ")}>"
}

Title: ${jobTitle}
Description: ${description.slice(0, 4000)}
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "system", content: prompt }],
      temperature: 0,
    });
    const raw = completion.choices[0]?.message?.content?.trim();
    return JSON.parse(raw);
  } catch (err) {
    console.warn("⚠️ classifyWithAI failed:", err.message);
    return null;
  }
}

/** AI rewriter for description */
async function formatDescription(description) {
  if (!description || !description.trim()) return "";
  const prompt = `
Rewrite the job description in clean Markdown:
- Use short sections with **bold** sub-headers (e.g., **Overview**, **Responsibilities**, **Requirements**, **Benefits**, **How to Apply**)
- Use '-' for bullet lists
- Remove noise and duplicate lines
- Keep facts accurate

Return ONLY the rewritten content.

Original:
${description.slice(0, 5000)}
`;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    });
    return completion.choices[0]?.message?.content?.trim() || description;
  } catch (err) {
    console.warn("⚠️ formatDescription failed:", err.message);
    return description;
  }
}

/** Ensure company exists; returns company_id (uuid) */
async function ensureCompanyId(companyName) {
  if (!companyName || !companyName.trim()) return null;

  const { data: existing, error: findErr } = await supabase
    .from("companies")
    .select("id, name")
    .eq("name", companyName.trim())
    .maybeSingle();

  if (findErr) {
    console.warn("⚠️ company lookup failed:", findErr.message);
    return null;
  }
  if (existing?.id) return existing.id;

  const { data: created, error: insErr } = await supabase
    .from("companies")
    .insert([{ name: companyName.trim() }])
    .select("id")
    .single();

  if (insErr) {
    console.warn("⚠️ company insert failed:", insErr.message);
    return null;
  }
  return created?.id || null;
}

/** ---------- MAIN ---------- **/

async function scrapeAndProcessJobs(searchUrl) {
  console.log("Fetching categories from Supabase...");
  const { data: categoriesData, error: categoriesError } = await supabase
    .from("categories")
    .select("name");

  if (categoriesError || !categoriesData?.length) {
    console.error("❌ Failed to fetch categories:", categoriesError?.message);
    return;
  }
  const categories = categoriesData.map((c) => c.name);
  console.log(`✅ Loaded ${categories.length} categories.`);

  console.log("Fetching existing jobs (URLs)...");
  const { data: existingJobs, error: fetchError } = await supabase
    .from("jobs")
    .select("url");

  if (fetchError) {
    console.error("❌ Error fetching existing jobs:", fetchError.message);
    return;
  }
  const existingUrls = new Set((existingJobs || []).map((j) => j.url).filter(Boolean));
  console.log(`✅ Found ${existingUrls.size} existing URLs.`);

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

  const listSelector = "li.sc-3bbad5b8-1";
  const nextButtonSelector = 'button[aria-label="Goto next page"]';
  const loaderSelector = ".sc-bYutwE";
  const readMoreButtonSelector = 'button[data-event-track="view-all-opportunity-description"]';
  const modalSelector = 'div[role="dialog"][data-state="open"]';
  const modalDescriptionSelector = `${modalSelector} [data-testid="raw-html"]`;
  const dateSelector = "span.sc-58338662-5.ibFCPI"; // <-- ADDED

  await page.waitForSelector(listSelector, { visible: true });
  await delay(1200);
  console.log("✅ Initial job list loaded.");

  let pageNum = 1;

  while (true) {
    console.log(`\n--- Scraping Page ${pageNum} ---`);

    const cards = await page.$$eval(listSelector, (nodes) =>
      nodes.map((li, index) => {
        const txt = (sel) => li.querySelector(sel)?.innerText?.trim() || "";
        const rawHref = li.querySelector('a[data-event-track="cta-apply"]')?.getAttribute("href") || null;
        return {
          index,
          title: txt("h2.sc-dOfePm a"),
          company: txt("p.sc-692f12d5-5"),
          location: txt("p.sc-692f12d5-15"),
          rawHref,
        };
      })
    );

    console.log(`Found ${cards.length} job listings.`);
    const jobsOnPage = cards.map((c) => ({ ...c, url: decodeProspleUrl(c.rawHref) || null }));

    const newJobs = jobsOnPage.filter((j) => j.url && !existingUrls.has(j.url));
    console.log(`🆕 ${newJobs.length} new jobs found on this page.`);

    for (let i = 0; i < newJobs.length; i++) {
      const job = newJobs[i];
      console.log(`Processing new job ${i + 1} of ${newJobs.length}: ${job.title}`);

      const cardsNow = await page.$$(listSelector);
      const cardEl = cardsNow[job.index];
      if (!cardEl) {
        console.warn("⚠️ Could not find card by index; skipping.");
        continue;
      }
      await cardEl.evaluate((el) => el.scrollIntoView({ behavior: "auto", block: "center" }));
      await delay(200);
      await cardEl.click();
      await delay(600);

      // Scrape full description
      let fullDescription = "";
      try {
        const readMoreBtn = await page.$(readMoreButtonSelector);
        if (readMoreBtn) {
          await readMoreBtn.click();
          await page.waitForSelector(modalSelector, { visible: true, timeout: 8000 });
          fullDescription = await page.$eval(modalDescriptionSelector, (el) => el.innerText.trim());
          const closeBtn =
            (await page.$(`${modalSelector} button[aria-label="Close"]`)) ||
            (await page.$(`${modalSelector} button.sc-ljIkKL`));
          if (closeBtn) await closeBtn.click();
          await delay(300);
        } else {
          console.warn("⚠️ No 'read more' button; description may be truncated.");
        }
      } catch (err) {
        console.warn("⚠️ Could not open/read modal:", err.message);
      }

      /** NEW: Extract start date & deadline */
      const dateTexts = await page.$$eval(dateSelector, (spans) =>
        spans.map((el) => el.innerText.trim())
      );

      let deadline = null;
      let start_date = null;
      for (const text of dateTexts) {
        if (/^Apply by/i.test(text)) {
          deadline = parseDateFromText(text);
        } else if (/^Start date/i.test(text)) {
          start_date = parseDateFromText(text);
        }
      }

      // Classification logic
      let jobType = classifyJobTypeHeuristic(job.title, fullDescription);
      let category = null;

      if (jobType === "unknown") {
        const ai = await classifyWithAI(job.title, fullDescription, categories);
        if (ai?.job_type) jobType = ai.job_type;
        if (ai?.category && categories.includes(ai.category)) category = ai.category;
      }

      if (/\bintern(ship)?s?\b/i.test(job.title)) jobType = "internship";
      if (/\bclerkship\b/i.test(job.title)) jobType = "clerkship";
      if (/\bplacement\b/i.test(job.title) && !/\bintern(ship)?s?\b/i.test(job.title)) jobType = "placement";

      if (!category) {
        const t = job.title.toLowerCase();
        if (t.includes("finance")) category = "Finance";
        else if (t.includes("law") || t.includes("legal")) category = "Law";
        else if (t.includes("marketing")) category = "Marketing";
        else if (t.includes("data") || t.includes("ai") || t.includes("machine learning")) category = "Technology";
        else if (t.includes("it") || t.includes("computer") || t.includes("cyber")) category = "Technology";
        else category = "Other";
        if (!categories.includes(category)) category = categories[0];
      }

      if (jobType !== "placement") {
        console.log(`↩️  Not a placement (classified as ${jobType}). Skipping insert.`);
        continue;
      }

      const formattedDescription = await formatDescription(fullDescription || "");
      const salary = normalizeSalary(fullDescription || formattedDescription || "");

      const company_id = await ensureCompanyId(job.company);
      if (!company_id) {
        console.warn("⚠️ Missing or failed company_id; skipping insert.");
        continue;
      }

      const now = new Date().toISOString();
      const record = {
        job_title: job.title,
        deadline,
        start_date,
        location: job.location || null,
        job_type: jobType,
        category,
        description: formattedDescription || fullDescription || "",
        url: job.url,
        created_at: now,
        updated_at: now,
        company_id,
        salary,
      };

      console.log("\n--- NEW JOB TO INSERT ---");
      console.log(record);
      console.log("-------------------------\n");

      const { error: insertError } = await supabase.from("jobs").insert([record]);
      if (insertError) {
        console.error("❌ Insert error:", insertError.message);
        continue;
      }

      existingUrls.add(job.url);
    }

    const nextBtn = await page.$(nextButtonSelector);
    if (!nextBtn) {
      console.log("✅ No more pages found. Scraping complete.");
      break;
    }

    console.log(`Moving to page ${pageNum + 1}...`);
    const prevCount = await page.$$eval(listSelector, (items) => items.length);
    await nextBtn.click();

    try {
      await page.waitForSelector(loaderSelector, { visible: true, timeout: 5000 }).catch(() => {});
      await page.waitForSelector(loaderSelector, { hidden: true, timeout: 7000 }).catch(() => {});
      await page.waitForFunction(
        (sel, oldCount) => {
          const n = document.querySelectorAll(sel).length;
          return n > 0 && n !== oldCount;
        },
        { timeout: 7000 },
        listSelector,
        prevCount
      );
      await delay(1000);
      console.log("✅ Next page loaded and stabilized.");
    } catch {
      console.warn("⚠️ Pagination wait timed out; continuing anyway.");
      await delay(1200);
    }

    pageNum++;
  }

  await browser.close();
  console.log("🎉 Finished scraping.");
}

module.exports = scrapeAndProcessJobs;
