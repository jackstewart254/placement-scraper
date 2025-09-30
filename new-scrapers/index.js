import "dotenv/config";

import { scrapeAllHigherInJobs } from "./htmlFetch.js";
import { scrapeJobDetails } from "./descriptionFetch.js";
import supabase from "../utils/supabase.js";

async function main() {
  try {
    // Fetch URLs already being processed
    const { data: processing, error: processingError } = await supabase
      .from("processing")
      .select("url");

    if (processingError) {
      console.error("❌ Error fetching from processing:", processingError.message);
    } else {
      console.log("Processing table:", processing);
    }

    // Scrape HigherIn jobs
    const data = await scrapeAllHigherInJobs();
    console.log(`✅ Found ${data.length} jobs`);

    // Scrape details for first 5 jobs
    const descriptions = await scrapeJobDetails(data.slice(0, 5));
    console.log("Descriptions:", descriptions[0]);
  } catch (err) {
    console.error("❌ Main script failed:", err.message);
  }
}

main();
