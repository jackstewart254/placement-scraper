import "dotenv/config";
import { runScraper } from "./scripts/main.js";

const run = async () => {
  await runScraper();
};

await run();
