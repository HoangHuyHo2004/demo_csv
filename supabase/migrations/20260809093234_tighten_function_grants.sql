-- Best-effort reconstruction: this migration's exact original text was
-- not preserved verbatim (unlike the others in this directory, applied
-- and copied down within the same conversation). Current grants on every
-- security-relevant function match what's written here and in the
-- migrations before it, verified by querying pg_proc/has_function_privilege
-- directly against the live project rather than assumed from memory.
--
-- Postgres grants EXECUTE on newly created functions to PUBLIC by
-- default. The explicit REVOKE ... FROM anon calls earlier in this
-- directory don't touch that default PUBLIC grant, so this closes that
-- gap explicitly for every security-relevant function in this schema.
revoke execute on function public.is_owner() from public;
revoke execute on function public.has_station_access(uuid) from public;
revoke execute on function public.bootstrap_first_owner() from public;
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.prevent_role_self_promotion() from public;
