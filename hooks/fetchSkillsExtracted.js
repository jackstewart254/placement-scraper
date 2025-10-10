import supabase from "../utils/supabase.js";

const fetchSkillsExtracted = async () => {
  let allRecords = [];
  let from = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("skills_extracted")
      .select("*")
      .range(from, from + pageSize - 1);

    if (error) throw error;

    allRecords.push(...data);
    console.log(`Fetched ${data.length} rows...`);

    if (data.length < pageSize) {
      hasMore = false;
    } else {
      from += pageSize;
    }
  }

  return allRecords
}

export default fetchSkillsExtracted