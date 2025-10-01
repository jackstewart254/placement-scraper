import express from "express";
import { runScraper } from "../scripts/main.js";

const app = express();

// Home route
app.get("/", (req, res) => {
  res.json({ message: "Hello from Express on Vercel!" });
});

// Scraper trigger
app.get("/scrape", async (req, res) => {
  try {
    const result = await runScraper();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default app;
