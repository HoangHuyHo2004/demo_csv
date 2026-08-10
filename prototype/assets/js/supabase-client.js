// Singleton Supabase client. Version pinned deliberately -- an unpinned
// `@2` on a static site with no build step means a future breaking release
// on the CDN silently changes behavior for every visitor at once.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
