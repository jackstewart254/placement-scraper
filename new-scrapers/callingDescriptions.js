import supabase from "../utils/supabase.js";
import { getDescriptions } from "./getDescriptions.js";
import { linkProcessingToJobs } from "../temp.js";

const callDescriptions = async () => {
  const { data: jobs, error: jobsError } = await supabase
    .from("processing")
    .select("id, url")
    .eq("ready", true);

  if (jobsError) {
    console.error("Error fetching jobs:", jobsError);
    return [];
  }

  getDescriptions(jobs)
};

export default callDescriptions
