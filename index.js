import "dotenv/config";

import { scrapeAllHigherInJobs } from "./new-scrapers/htmlFetch.js";
import { scrapeJobDetails } from "./new-scrapers/descriptionFetch.js";
import supabase from "./utils/supabase.js";
import normaliseLocations from "./new-scrapers/normaliseLocations.js";

async function main() {
  try {
    normaliseLocations()
    // Fetch URLs already being processed
  //   const { data: processing, error: processingError } = await supabase
  //     .from("processing")
  //     .select("url")
  //     .eq('origin', "higherin")

  //   if (processingError) {
  //     console.error("❌ Error fetching from processing:", processingError.message);
  //   } else {
  //     console.log("Processing table:", processing);
  //   }

  //   // Scrape HigherIn jobs
  //   const data = await scrapeAllHigherInJobs(processing);
  //   console.log(`✅ Found ${data.length} jobs`);

  //   // Scrape details for first 5 jobs
  //   await scrapeJobDetails(data);
  } catch (err) {
    // console.error("❌ Main script failed:", err.message);
  }
}

main();
