const { parse, format } = require('date-fns');

function parseDates(opened) {
  console.log(opened);
  if (!opened) return null;

  try {
    const parsedDate = parse(opened, 'dd MMM yy', new Date());
    console.log(parsedDate); 
    return format(parsedDate, 'yyyy-MM-dd');
  } catch (error) {
    console.error("Error parsing date:", opened, error);
    return null;
  }
}

module.exports = parseDates;
