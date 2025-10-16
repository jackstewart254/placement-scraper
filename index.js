import "dotenv/config";
import { runScraper } from "./scripts/main.js";
import callDescriptions from "./new-scrapers/callingDescriptions.js";
import { runSkillExtractionPipeline } from "./scripts/extractKeySkills.js";
import { auditTokenUsage } from "./tokenCalculator.js";
import { normalizeAllSkills } from "./scripts/unifySkills.js";
import fetchProcessing from "./hooks/fetchProcessing.js";
import { normalizeUserSkills } from "./scripts/generatingSkillsForExistingUsers.js";
import runExtract from "./scripts/unifySkillNames.js";
import runExtractSkills from "./scripts/extractSkills.js";
import runSkillNormalisation from "./scripts/runSkillNormalisation.js";
import main from "./ann/vectorMatching.js"
import fetchProcessingIds from "./ANNTest.js";

const run = async () => {
  // await runScraper();
  // await callDescriptions()

  // index.js

  // await runSkillExtractionPipeline();
  // normalizeAllSkills();
  // runExtract()
  // runExtractSkills()
  // runSkillNormalisation()
  // main()
  fetchProcessingIds()
  // normalizeUserSkills()

  
};

await run();
