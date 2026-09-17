// Where the data comes from.
//
// Leave these empty and the app runs on in-memory demo data — the board still
// works, nothing is saved. Fill them in and it talks to Supabase.
//
// The anon key belongs in public client code; that is what it is for. Security
// rests on the row-level security policies in supabase/migrations, not on this
// key being secret. See docs/adr/0004.
window.HOUSEHOLD_CONFIG = {
  supabaseUrl: 'https://xyiqgzhpunqzogjoxjvr.supabase.co',
  // The publishable key (sb_publishable_…), never a secret one. Supabase marks
  // it "can be safely shared publicly": anon has no table privileges at all
  // (0010), and signed-in access is bounded by row-level security.
  supabaseAnonKey: 'sb_publishable_BuAl3b-Q70BeR4wSiDfBjg_woPgh0ZH'
};
