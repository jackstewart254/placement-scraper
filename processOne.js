const fetchTechPlacements = require("./fetchTechPlacements");
const syncJobsToDatabase = require("./syncJobsToDatabase");

const processOne = async () => {
  const jobs = await fetchTechPlacements();
  console.log(jobs);
  syncJobsToDatabase(jobs);
};

module.exports = processOne;
