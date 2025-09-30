require("dotenv").config();
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const OpenAI = require("openai");

puppeteer.use(StealthPlugin());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Dummy information to auto-fill application forms
const dummyData = {
  firstname: "John",
  lastname: "Doe",
  email: "john.doe@example.com",
  phone: "0123456789",
  address: "123 Main Street, London, UK",
  city: "London",
  postcode: "W1A 1AA",
  cvPath: "./dummy_cv.pdf",
};

// Helper delay
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// AI to analyze current page HTML
async function analyzeStepWithAI(html) {
  const prompt = `
You are an expert at analyzing job application forms.
Given the HTML below, identify all fields and return them as JSON.

Return JSON ONLY in this exact format:
{
  "step_number": 1,
  "title": "Step Title",
  "fields": [
    { "type": "text", "label": "First Name", "required": true },
    { "type": "file", "label": "Upload CV", "required": true },
    { "type": "checkbox", "label": "Accept Terms", "required": true }
  ]
}

HTML:
${html}
  `;

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [{ role: "system", content: prompt }],
    temperature: 0,
  });

  try {
    return JSON.parse(completion.choices[0].message.content);
  } catch (err) {
    console.error("❌ Failed to parse AI response:", err.message);
    console.log("AI Raw Response:", completion.choices[0].message.content);
    return null;
  }
}

// Attempt to click the initial "Apply" button if present
async function clickInitialApplyButton(page) {
  const applyButton = await page.$("button");
  if (applyButton) {
    const text = await page.evaluate((el) => el.innerText.toLowerCase(), applyButton);
    if (text.includes("apply")) {
      console.log("🟢 Clicking initial Apply button...");
      await applyButton.click();
      await delay(3000); // wait for modal or next page
      return true;
    }
  }
  return false;
}

async function scrapeSingleJob(jobUrl) {
  console.log(`🚀 Starting scraper for: ${jobUrl}`);

  const browser = await puppeteer.launch({
    headless: false, // show browser for debugging
    defaultViewport: { width: 1280, height: 900 },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const page = await browser.newPage();
  await page.goto(jobUrl, { waitUntil: "networkidle2" });
  console.log("✅ Loaded job listing page.");

  // Try initial Apply button
  await clickInitialApplyButton(page);

  let stepNumber = 1;
  const allSteps = [];

  while (true) {
    console.log(`\n🔹 Processing Step ${stepNumber}...`);

    // 1. Capture current step's HTML
    const html = await page.content();

    // 2. Analyze HTML with OpenAI
    const stepAnalysis = await analyzeStepWithAI(html);
    if (!stepAnalysis) {
      console.error("⚠️ Skipping step due to AI parsing issue.");
      break;
    }

    stepAnalysis.step_number = stepNumber;
    allSteps.push(stepAnalysis);

    console.log(`📝 Step ${stepNumber} JSON:`, JSON.stringify(stepAnalysis, null, 2));

    // 3. Attempt to fill out form fields
    for (const field of stepAnalysis.fields) {
      try {
        const fieldLabel = field.label.toLowerCase();

        if (["text", "email", "tel"].includes(field.type)) {
          // Try to match input by placeholder or name
          const selector = `input[placeholder*="${field.label}" i], input[name*="${field.label}" i]`;
          const value = dummyData[fieldLabel] || "John Doe";

          const input = await page.$(selector);
          if (input) {
            await input.click({ clickCount: 3 });
            await input.type(value, { delay: 50 });
            console.log(`✏️ Filled ${field.label} with "${value}"`);
          }
        } else if (field.type === "file") {
          const fileInput = await page.$('input[type="file"]');
          if (fileInput && fs.existsSync(dummyData.cvPath)) {
            await fileInput.uploadFile(dummyData.cvPath);
            console.log(`📄 Uploaded dummy CV for ${field.label}`);
          }
        } else if (field.type === "checkbox") {
          const checkbox = await page.$('input[type="checkbox"]');
          if (checkbox) {
            await checkbox.click();
            console.log(`☑️ Checked ${field.label}`);
          }
        } else if (field.type === "select") {
          const select = await page.$("select");
          if (select) {
            const options = await select.$$("option");
            if (options.length > 1) {
              await select.select(await page.evaluate((el) => el.value, options[1]));
              console.log(`🔽 Selected first available option for ${field.label}`);
            }
          }
        }
      } catch (err) {
        console.warn(`⚠️ Could not fill field "${field.label}": ${err.message}`);
      }
    }

    // 4. Find navigation buttons
    const buttons = await page.$$("button");
    let buttonClicked = false;

    for (const button of buttons) {
      const text = await page.evaluate((el) => el.innerText.toLowerCase(), button);

      if (["next", "continue", "submit", "apply"].some((word) => text.includes(word))) {
        console.log(`➡️ Clicking button: ${text}`);
        await button.click();
        await delay(3000); // wait for next step
        stepNumber++;
        buttonClicked = true;
        break;
      }
    }

    if (!buttonClicked) {
      console.log("🏁 No next/continue/submit button found. Assuming end of application.");
      break;
    }
  }

  console.log("\n🎉 Application Flow Complete!");
  console.log(JSON.stringify(allSteps, null, 2));

  await browser.close();
}

// Example usage
const jobUrl =
  "https://mbgp.wd3.myworkdayjobs.com/en-US/mercedes-amgf1/job/Car-Build-Industrial-Placement_REQ-250381?locations=80df7dc39bb31001fab982af84000000";

scrapeSingleJob(jobUrl);
