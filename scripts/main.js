import "dotenv/config";

import { scrapeAllHigherInJobs } from "../new-scrapers/htmlFetch.js";
import { scrapeJobDetails } from "../new-scrapers/descriptionFetch.js";
import supabase from "../utils/supabase.js";
import normaliseLocations from "../new-scrapers/normaliseLocations.js";
import migrateProcessingToJobs from "../components/insertIntoJobs.js";

export async function runScraper() {
  try {
    const { data: processing, error: processingError } = await supabase
      .from("processing")
      .select("url")
      .eq("origin", "higherin");

    if (processingError) {
      console.error(
        "❌ Error fetching from processing:",
        processingError.message
      );
      return { success: false, error: processingError.message };
    }

    console.log("Processing table:", processing);

    const data = await scrapeAllHigherInJobs(processing);
    console.log(`✅ Found ${data.length} jobs`);

    await scrapeJobDetails(data);
    await normaliseLocations();
    await migrateProcessingToJobs();

    return { success: true, jobs: data.length };
  } catch (err) {
    console.error("❌ Main script failed:", err.message);
    return { success: false, error: err.message };
  }
}
