import "dotenv/config";
import { runScraper } from "./scripts/main.js";
import callDescriptions from "./new-scrapers/callingDescriptions.js";
import { runSkillExtractionPipeline } from "./scripts/extractKeySkills.js";
import { auditTokenUsage } from "./tokenCalculator.js";
import { normalizeAllSkills } from "./scripts/unifySkills.js";
import fetchProcessing from "./hooks/fetchProcessing.js";
import { normalizeUserSkills } from "./scripts/generatingSkillsForExistingUsers.js";
import runExtract from "./scripts/unifySkillNames.js";

const run = async () => {
  // await runScraper();
  // await callDescriptions()

  // index.js

  // await runSkillExtractionPipeline();
  // normalizeAllSkills();
  runExtract()
  // normalizeUserSkills()

  
};

await run();
