import supabase from "../../utils/supabase.js";

const fetchSkillVectors = async () => {
  let allRecords = [];
  let from = 0;
  const pageSize = 500;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("skills_vectors")
      .select("id, extracted_id, embedding")
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

export default fetchSkillVectors