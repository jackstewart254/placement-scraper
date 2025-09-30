import { parse } from "date-fns";

// helper to normalise deadline string
function parseDeadline(text) {
  if (!text) return null;

  try {
    // remove suffixes like "st", "nd", "rd", "th"
    const cleaned = text.replace(/(\d+)(st|nd|rd|th)/, "$1");

    // Try to parse with format "d MMMM yyyy" (e.g., "30 September 2025")
    const parsed = parse(cleaned, "d MMMM yyyy", new Date());

    if (!isNaN(parsed)) {
      return parsed.toISOString().split("T")[0]; // "YYYY-MM-DD"
    }
  } catch (err) {
    console.warn("⚠️ Could not parse deadline:", text, err.message);
  }
  return null;
}

export default parseDeadline