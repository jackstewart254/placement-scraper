import supabase from "./utils/supabase.js"

async function fetchProcessingIds() {
  console.log("📦 Fetching all rows from skills_jobs...");

  const allRows = [];
  let from = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("skills_jobs")
      .select("processing_id")
      .range(from, from + pageSize - 1);

    if (error) {
      console.error("❌ Error fetching rows:", error);
      break;
    }

    if (!data?.length) {
      hasMore = false;
      break;
    }

    allRows.push(...data);
    console.log(`📥 Fetched ${data.length} rows (total: ${allRows.length})`);

    if (data.length < pageSize) hasMore = false;
    else from += pageSize;
  }

  // ✅ Extract unique processing_ids
  const processingIds = [
    ...new Set(allRows.map((r) => r.processing_id).filter(Boolean)),
  ];

  console.log("🧾 All processing_ids:\n", processingIds.join("\n"));

  console.log("\n✅ Unique processing_ids found:", processingIds.length);
}

export default fetchProcessingIds
