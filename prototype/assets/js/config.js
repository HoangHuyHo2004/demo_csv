// Supabase connection info for Demo_CSV.
//
// SAFE TO COMMIT: the value below is the "publishable" key, not a secret.
// It is an identifier that tells Supabase's REST API "this request is from
// project X, acting as the `anon` role" -- shipping it in a client bundle is
// exactly what it is designed for (every Supabase web app has it in
// view-source). With Row Level Security enabled on every table, `anon` and
// even `authenticated` can do nothing until a user signs in and gets a JWT,
// and even then it is the RLS policies -- not this key -- that decide what
// they can see or change.
//
// The key that must NEVER appear in this repository is the `service_role`
// key. That one bypasses Row Level Security entirely and belongs only on a
// trusted server, which this static site does not have.
export const SUPABASE_URL = 'https://lqyezdifrlrkhfsqlfkv.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_EXVBRqu8Jb7gS7ALB-yiew_zyzAyOYo';
