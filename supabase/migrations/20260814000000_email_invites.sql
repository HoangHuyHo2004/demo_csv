-- Invite-gated sign-up: "Create account" used to accept any email --
-- Settings' "Send invite" button and Security's "Team members" table were
-- both static mockups. This makes them real, and makes handle_new_user()
-- (the AFTER INSERT ON auth.users trigger that creates the matching
-- profiles row on every sign-up) reject any email the Owner hasn't
-- invited. A trigger exception here rolls back the whole transaction,
-- including the auth.users insert -- so this is the real enforcement
-- point, not just a client-side check.
--
-- The very first sign-up is unaffected: bootstrap_first_owner() (see
-- 20260809092403_bootstrap_owner.sql) still separately promotes them
-- once no Owner exists yet, exactly as today.

-- profiles.email: the client can't query auth.users directly, and the
-- real Team members list needs to show who's on the team.
alter table public.profiles add column email text;
update public.profiles p set email = u.email from auth.users u where u.id = p.id;

create table public.invites (
  email       text primary key,   -- lowercased; the one the invited person must sign up with
  role        app_role not null default 'accountant',
  invited_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

alter table public.invites enable row level security;

-- Same shape as stations/categories owner-only tables: only the Owner
-- can see or manage invites. handle_new_user() itself runs security
-- definer, so it isn't subject to this RLS during sign-up.
create policy "invites: owner all" on public.invites
  for all using (public.is_owner()) with check (public.is_owner());

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  matched_invite public.invites;
  owner_exists boolean;
begin
  owner_exists := exists (select 1 from public.profiles where role = 'owner');

  if owner_exists then
    select * into matched_invite from public.invites where email = lower(new.email);
    if matched_invite is null then
      raise exception 'This email has not been invited by the Owner.';
    end if;
  end if;

  insert into public.profiles (id, display_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', new.email),
    new.email,
    coalesce(matched_invite.role, 'accountant')
  );

  if matched_invite.email is not null then
    delete from public.invites where email = matched_invite.email;
  end if;

  return new;
end;
$$;
