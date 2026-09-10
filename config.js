// Where the data comes from.
//
// Leave these empty and the app runs on in-memory demo data — the board still
// works, nothing is saved. Fill them in and it talks to Supabase.
//
// The anon key belongs in public client code; that is what it is for. Security
// rests on the row-level security policies in supabase/migrations, not on this
// key being secret. See docs/adr/0004.
window.HOUSEHOLD_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: ''
};
