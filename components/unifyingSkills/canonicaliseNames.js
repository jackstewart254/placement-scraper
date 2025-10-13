function canonicalizeSkillName(skill) {
  if (!skill || typeof skill !== "string") return "";
  return skill.trim().toLowerCase().replace(/\s+/g, "");
}

export default canonicalizeSkillName;