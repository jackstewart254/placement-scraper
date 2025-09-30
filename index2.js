require("dotenv").config();

const { scrapeProspleSearch } = require("./scrapers/prosple");
const scrapeAndProcessJobs = require("./scrapers/newProsple")
const normalizeLocationsHierarchical = require('./unifyingLocations')

const prospleSampleContents = {
  446208: {
    "content-name": "Design Manager Graduate",
    "parent-name": "Cundall UK",
    "opportunity-type": { label: "Graduate Job or Program" },
  },
};

async function main() {
  // classifyJobs()

  // Scraping prosple jobs and inserting them into the database
  await scrapeAndProcessJobs(
    "https://uk.prosple.com/search-jobs?locations=9949&defaults_applied=1&opportunity_types=2"
  );

  // Normalising the locations across placements
  // await normalizeLocationsHierarchical()
}

main().catch((err) => {
  console.error("Error running scraper:", err);
});
