require("dotenv").config();

const { scrapeProspleSearch } = require("./scrapers/prosple");
const { scrapeGradcrackerJobs } = require("./scrapers/gradcracker");
const { scrapeHigherinJobs } = require("./scrapers/higherin");

const prospleSampleContents = {
  446208: {
    "content-name": "Design Manager Graduate",
    "parent-name": "Cundall UK",
    "opportunity-type": { label: "Graduate Job or Program" },
  },
};

async function main() {
  classifyJobs()
//   console.log("Starting scraping process...");

//   // Step 1: Scrape Prosple jobs (basic JSON data)
//   await scrapeProspleSearch(
//     "https://uk.prosple.com/search-jobs?locations=9949&defaults_applied=1&opportunity_types=2"
//   );

//   // Step 2: Scrape Gradcracker jobs (HTML)
//   await scrapeGradcrackerJobs();

//   // Step 3: Scrape Higherin jobs (HTML)
//   await scrapeHigherinJobs();

//   console.log("Scraping completed.");
}

main().catch((err) => {
  console.error("Error running scraper:", err);
});
