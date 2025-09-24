const supabase = require("./utils/supabase");

/**
 * Sync scraped jobs with the database
 * @param {Array} scrapedJobs - array of jobs from scraper
 */
const syncJobsToDatabase = async (scrapedJobs) => {
  console.log("Starting sync...");
  console.log("Scraped jobs at start:", scrapedJobs.length);

  const { data: companies, error: companiesError } = await supabase
    .from("companies")
    .select("id, name");

  if (companiesError) {
    console.error("Error fetching companies:", companiesError);
    return;
  }

  const { data: jobs, error: jobsError } = await supabase
    .from("jobs")
    .select("id, company_id, job_title");

  if (jobsError) {
    console.error("Error fetching jobs:", jobsError);
    return;
  }

  console.log(`Fetched ${companies.length} companies and ${jobs.length} jobs.`);

  const companyMap = new Map(
    companies.map((c) => [c.name.toLowerCase(), c.id])
  );
  const jobMap = new Map(
    jobs.map((j) => [`${j.company_id}-${j.job_title.toLowerCase()}`, j.id])
  );

  const newCompanies = [];
  const newJobs = [];

  for (const job of scrapedJobs) {
    const {
      company,
      jobTitle,
      opened,
      url,
      cvRequired,
      coverLetterRequired,
      writtenAnswersRequired,
      category,
    } = job;

    if (!company || !jobTitle) continue;

    const companyKey = company.toLowerCase();

    let companyId = companyMap.get(companyKey);

    if (!companyId) {
      const newCompany = { name: company };
      newCompanies.push(newCompany);
      console.log(`New company found: ${company}`);
    }
  }

  if (newCompanies.length > 0) {
    const { data: insertedCompanies, error: insertCompanyError } =
      await supabase.from("companies").insert(newCompanies).select();

    if (insertCompanyError) {
      console.error("Error inserting new companies:", insertCompanyError);
      return;
    }

    insertedCompanies.forEach((c) => {
      companyMap.set(c.name.toLowerCase(), c.id);
    });

    console.log(`Inserted ${insertedCompanies.length} new companies.`);
  }

  for (const job of scrapedJobs) {
    const {
      company,
      jobTitle,
      opened,
      url,
      cvRequired,
      coverLetterRequired,
      writtenAnswersRequired,
      category,
    } = job;

    if (!company || !jobTitle) continue;

    const companyId = companyMap.get(company.toLowerCase());
    if (!companyId) continue;

    const jobKey = `${companyId}-${jobTitle.toLowerCase()}`;

    if (!jobMap.has(jobKey)) {
      newJobs.push({
        company_id: companyId,
        job_title: jobTitle,
        opened,
        url,
        cv: cvRequired === "Yes",
        cover_letter: coverLetterRequired === "Yes",
        written_answers: writtenAnswersRequired === "Yes",
        category,
      });

      console.log(`New job found: ${company} - ${jobTitle}`);
    }
  }

  if (newJobs.length > 0) {
    const { data: insertedJobs, error: insertJobError } = await supabase
      .from("jobs")
      .insert(newJobs)
      .select();

    if (insertJobError) {
      console.error("Error inserting new jobs:", insertJobError);
      return;
    }

    console.log(`Inserted ${insertedJobs.length} new jobs.`);
  } else {
    console.log("No new jobs to insert.");
  }

  console.log("Sync complete.");
};

module.exports = syncJobsToDatabase;
