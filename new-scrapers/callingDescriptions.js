import supabase from "../utils/supabase.js";
import fetchProcessing from "../hooks/fetchProcessing.js";
import fetchDescriptions from "../hooks/fetchDescriptions.js";
import { getDescriptions } from "./getDescriptions.js"; 

export default async function callDescriptions() {
  const jobs = await fetchProcessing(); // [{ id, ... }]
  const descriptions = await fetchDescriptions(); // [{ processing_id, description }]

  // Create a Set of all processing_ids that have descriptions
  const describedSet = new Set(descriptions.map(d => d.processing_id));

  // Filter jobs that are missing a matching description
  const missingDescriptions = jobs.filter(job => !describedSet.has(job.id));


  getDescriptions(missingDescriptions)
}
