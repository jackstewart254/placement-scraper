require("dotenv").config();
const supabase = require("./utils/supabase");

async function populateCategories() {
  try {
    // 1. Fetch all existing categories from jobs
    const { data: jobs, error } = await supabase
      .from("jobs")
      .select("category");

    if (error) throw error;

    if (!jobs || jobs.length === 0) {
      console.log("No jobs found.");
      return;
    }

    console.log(`Fetched ${jobs.length} jobs.`);

    // 2. Collect unique categories from jobs
    const categoriesSet = new Set();

    for (const job of jobs) {
      if (job.category && job.category.trim() !== "") {
        categoriesSet.add(job.category.trim());
      }
    }

    const categories = Array.from(categoriesSet);

    console.log("Unique categories found:", categories);

    // 3. Fetch existing categories in the categories table
    const { data: existingCategories, error: existingError } = await supabase
      .from("categories")
      .select("name");

    if (existingError) throw existingError;

    const existingNames = new Set(existingCategories.map(cat => cat.name));

    // 4. Filter out categories that already exist
    const newCategories = categories.filter(cat => !existingNames.has(cat));

    if (newCategories.length === 0) {
      console.log("No new categories to insert.");
      return;
    }

    console.log("New categories to insert:", newCategories);

    // 5. Insert the new categories
    const { error: insertError } = await supabase
      .from("categories")
      .insert(newCategories.map(name => ({ name })));

    if (insertError) throw insertError;

    console.log("New categories inserted successfully!");
  } catch (err) {
    console.error("Error populating categories:", err.message);
  }
}

populateCategories();
