require("dotenv").config();
const puppeteer = require("puppeteer-extra");
const Stealth = require("puppeteer-extra-plugin-stealth");
puppeteer.use(Stealth());
const supabase = require("./utils/supabase");

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
    console.error("Failed to decode URL:", err.message);
    return null;
  }
}

async function updateRealJobUrls() {
  console.log("Fetching jobs from Supabase...");

  // Fetch all jobs with URLs
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, url")
    .not("url", "is", null);

  if (error) throw error;

  if (!jobs.length) {
    console.log("No jobs found.");
    return;
  }

  console.log(`Found ${jobs.length} jobs to process.`);

  const browser = await puppeteer.launch({
    headless: false, // Set to true if you don't need to see the browser
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
    defaultViewport: null,
  });

  const page = await browser.newPage();

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];

    // Progress log
    console.log(`\n[${i + 1}/${jobs.length}] Processing job ID ${job.id}`);

    // Skip jobs that don't have a Prosple URL
    if (!job.url.startsWith("https://uk.prosple")) {
      console.log("Skipping job - already has external URL.");
      continue;
    }

    try {
      // 1. Go to the Prosple job page
      console.log(`Navigating to: ${job.url}`);
      await page.goto(job.url, { waitUntil: "networkidle2", timeout: 60000 });

      // 2. Wait for the Apply button
      const applyButtonSelector = 'a[data-event-track="cta-apply"]';
      await page.waitForSelector(applyButtonSelector, {
        visible: true,
        timeout: 15000,
      });

      // 3. Get the href attribute
      const applyHref = await page.$eval(applyButtonSelector, (el) =>
        el.getAttribute("href")
      );

      if (!applyHref) {
        console.warn("⚠️ No apply button found. Skipping job.");
        continue;
      }

      // 4. Decode the real employer URL
      const realUrl = decodeProspleUrl(applyHref);
      if (!realUrl) {
        console.warn("⚠️ Could not decode real URL. Skipping job.");
        continue;
      }

      console.log(`Decoded real URL: ${realUrl}`);

      // 5. Update Supabase
      const { error: updateError } = await supabase
        .from("jobs")
        .update({ url: realUrl })
        .eq("id", job.id)
        .range(1000, 1052)

      if (updateError) {
        console.error(`❌ Error updating job ${job.id}:`, updateError.message);
      } else {
        console.log(`✅ Updated job ${job.id} successfully!`);
      }

      await delay(1000); // avoid rate limits
    } catch (err) {
      console.error(`❌ Error processing job ${job.id}:`, err.message);
    }
  }

  await browser.close();
  console.log("🎉 All jobs processed!");
}

updateRealJobUrls();
