import supabase from "../utils/supabase.js"
import canonicalizeSkillName from "../components/unifyingSkills/canonicaliseNames.js"
import stringSimilarity from "string-similarity";


const stepOne = async () => {
  const { data: skills, error: skillsError } = await supabase
    .from("skills")
    .select("skill_name");

  if (skillsError) {
    console.error(skillsError);
    return;
  }

  const skillMappings = skills.map((s) => ({
    display_name: s.skill_name,
    canonical_name: canonicalizeSkillName(s.skill_name),
  }));

  return skillMappings
};

const stepTwo = async () => {
  const skills = await stepOne();
  if (!skills) return;

  const threshold = 0.7; // similarity score (0–1)
  const maxResults = 5; // top N most similar skills

  // Extract canonical names for comparison
  const allCanonicalNames = skills.map((s) => s.canonical_name);

  const results = skills.map((skill) => {
    const { ratings } = stringSimilarity.findBestMatch(
      skill.canonical_name,
      allCanonicalNames
    );

    const similar = ratings
      .filter(
        (r) =>
          r.target !== skill.canonical_name && r.rating >= threshold
      )
      .sort((a, b) => b.rating - a.rating)
      .slice(0, maxResults)
      .map((r) => r.target);

    return {
      skill: skill.display_name,
      canonical_name: skill.canonical_name,
      similar_skills: similar,
    };
  });

  console.log(results.slice(100, 200));
  return results;
};




const runExtract = async () => {
  await stepTwo()
}

export default runExtract;