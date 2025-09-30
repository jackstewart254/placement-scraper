import { createClient } from "@supabase/supabase-js";

const supabaseUrl = 'https://ivptntebwnzqjlxpfpej.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;

console.log("ENV KEY (raw):", process.env.SUPABASE_KEY);
console.log("ENV keys loaded:", Object.keys(process.env));


const supabase = createClient(supabaseUrl, supabaseKey);

export default supabase
