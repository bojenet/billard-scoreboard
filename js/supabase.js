const supabaseUrl = "https://kstqhcaazuuxchqtnyfc.supabase.co";
const supabaseKey = "sb_publishable_0C-Hj42NxQ1UCHMkadC-Pw_KWDg6o2r";

window.supabaseClient = supabase.createClient(
  supabaseUrl,
  supabaseKey
);
