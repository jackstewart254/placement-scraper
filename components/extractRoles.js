// ✅ Extract job roles precisely from the "Job Roles:" section
function extractRoles($) {
  // Find the "Job Roles:" label (case-insensitive, with/without colon)
  const label = $('b').filter((_, el) =>
    /^\s*job roles:?$/i.test($(el).text().trim())
  ).first();

  let roles = [];

  if (label.length) {
    // The roles live in the next sibling wrapper after the label's container
    const container =
      label.closest('div.shrink-0').next('.flex.flex-wrap');

    roles = container.find('> div').map((_, el) =>
      $(el).text().replace(/\s+/g, ' ').trim()
    ).get();
  } else {
    // Fallback: use the briefcase icon header, then its next sibling
    const header = $('span.fa-briefcase, span.far.fa-briefcase')
      .closest('div.shrink-0');
    const container = header.next('.flex.flex-wrap');
    roles = container.find('> div').map((_, el) =>
      $(el).text().replace(/\s+/g, ' ').trim()
    ).get();
  }

  // Clean + dedupe
  roles = [...new Set(roles.filter(Boolean))];
  return roles;
}
export default extractRoles