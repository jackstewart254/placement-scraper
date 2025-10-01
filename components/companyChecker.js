// scripts/showProcessingCompanies.js
import supabase from "../utils/supabase.js";

export default async function showProcessingCompanies() {
  console.log("🔎 Fetching processing jobs with companies...");

  // 1. Fetch jobs with company_id + join companies
  const { data: jobs, error } = await supabase.from("processing").select(`
      id,
      job_title,
      company_id,
      logo,
      companies (
        id,
        name,
        logo
      )
    `);

  if (error) {
    console.error("❌ Error fetching processing jobs:", error.message);
    return;
  }

  if (!jobs || jobs.length === 0) {
    console.log("⚠️ No processing jobs found.");
    return;
  }

  // 2. Collect unique companies
  const companyMap = new Map();
  for (const job of jobs) {
    if (job.companies) {
      companyMap.set(job.companies.id, {
        pLogo: job.logo, // processing table logo
        name: job.companies.name,
        logo: job.companies.logo, // companies table logo
      });
    }
  }

  // 3. Display results
  console.log(`🏢 Found ${companyMap.size} unique companies:\n`);
  for (const [id, company] of companyMap.entries()) {
    console.log(
      `- ${company.name} | Company logo: ${
        company.logo || "❌ None"
      } | Processing logo: ${company.pLogo || "❌ None"}`
    );
    console.log("\n");
  }
}

// Run directly if executed as a script
showProcessingCompanies();
