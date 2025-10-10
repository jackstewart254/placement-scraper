import supabase from "./utils/supabase.js";
import { encode } from "gpt-tokenizer";

/* -----------------------------
   MODEL PRICING (USD per 1M tokens)
----------------------------- */
const PRICES = {
  "gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  "gpt-5": { input: 1.25 / 1_000_000, output: 10.0 / 1_000_000 }, // adjust once real prices released
};

/* -----------------------------
   TOKEN AUDIT SCRIPT
----------------------------- */
export async function auditTokenUsage() {
  console.log("📊 Starting token audit...");

  // 1️⃣ Fetch all extracted skills
  const { data: extractedRows, error: extractedError } = await supabase
    .from("skills_extracted")
    .select(
      "processing_id, cleaned_description, required_skills, skills_to_learn"
    );

  if (extractedError) throw extractedError;
  if (!extractedRows?.length) {
    console.log("⚠️ No rows found in skills_extracted.");
    return;
  }

  console.log(`📦 Found ${extractedRows.length} rows to audit.`);

  let totals = {
    clean_input: 0,
    clean_output: 0,
    extract_input: 0,
    extract_output: 0,
  };

  for (const row of extractedRows) {
    const {
      processing_id,
      cleaned_description,
      required_skills,
      skills_to_learn,
    } = row;

    // 2️⃣ Fetch original job description from descriptions table
    const { data: originalRow, error: descError } = await supabase
      .from("descriptions")
      .select("description")
      .eq("processing_id", processing_id)
      .maybeSingle();

    if (descError) {
      console.error(
        `❌ Error fetching description for ${processing_id}:`,
        descError.message
      );
      continue;
    }
    if (!originalRow?.description) {
      console.warn(`⚠️ Missing original description for ${processing_id}`);
      continue;
    }

    // 3️⃣ Tokenize
    const cleanInputTokens = encode(originalRow.description).length;
    const cleanOutputTokens = encode(cleaned_description || "").length;

    const extractInputText = cleaned_description || "";
    const extractOutputText = JSON.stringify({
      required_skills,
      skills_to_learn,
    });

    const extractInputTokens = encode(extractInputText).length;
    const extractOutputTokens = encode(extractOutputText).length;

    totals.clean_input += cleanInputTokens;
    totals.clean_output += cleanOutputTokens;
    totals.extract_input += extractInputTokens;
    totals.extract_output += extractOutputTokens;
  }

  // 4️⃣ Cost calculation
  const cleanCost =
    totals.clean_input * PRICES["gpt-4o-mini"].input +
    totals.clean_output * PRICES["gpt-4o-mini"].output;

  const extractCost =
    totals.extract_input * PRICES["gpt-5"].input +
    totals.extract_output * PRICES["gpt-5"].output;

  const totalCost = cleanCost + extractCost;

  // 5️⃣ Summary
  console.log("\n🧾 TOKEN USAGE SUMMARY");
  console.log("───────────────────────────────");
  console.log("🧼 Cleaning (gpt-4o-mini)");
  console.log(`   Input tokens:  ${totals.clean_input.toLocaleString()}`);
  console.log(`   Output tokens: ${totals.clean_output.toLocaleString()}`);
  console.log(`   → Cost: $${cleanCost.toFixed(4)}`);

  console.log("\n🧠 Extraction (gpt-5)");
  console.log(`   Input tokens:  ${totals.extract_input.toLocaleString()}`);
  console.log(`   Output tokens: ${totals.extract_output.toLocaleString()}`);
  console.log(`   → Cost: $${extractCost.toFixed(4)}`);

  console.log("\n📈 TOTAL SUMMARY");
  console.log("───────────────────────────────");
  console.log(`💰 Estimated total cost: $${totalCost.toFixed(4)}`);
  console.log(
    `📊 Total tokens: ${(
      totals.clean_input +
      totals.clean_output +
      totals.extract_input +
      totals.extract_output
    ).toLocaleString()}`
  );

  return { totals, cleanCost, extractCost, totalCost };
}
