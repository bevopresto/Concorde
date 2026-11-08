-- Concorde database. Run once in Supabase: SQL Editor > New query > paste this whole file > Run.
-- Safe to run again: everything uses "if not exists" or "create or replace".
-- Rule of thumb for the security rules below: a person can only see a chat if they are a member of it.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- people
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  c1          text not null default '#7C5CFA',
  c2          text not null default '#E0549F',
  avatar_path text,
  status      text not null default 'online' check (status in ('online','away','dnd','invisible')),
  is_owner    boolean not null default false,
  tower_seen_at timestamptz not null default 'epoch',
  created_at  timestamptz not null default now()
);
create unique index if not exists profiles_name_ci on public.profiles (lower(name));

-- Invite codes. The owner makes them; redeem_invite() uses them up.
create table if not exists public.invites (
  code       text primary key,
  created_by uuid references public.profiles(id) on delete set null,
  max_uses   int  not null default 10,
  uses       int  not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
-- Email-bound invites (sent from inside the app by the owner). One use, only for that address.
alter table public.invites add column if not exists email      text;
alter table public.invites add column if not exists used_by    uuid references public.profiles(id) on delete set null;
alter table public.invites add column if not exists used_at    timestamptz;
alter table public.invites add column if not exists revoked_at timestamptz;
alter table public.invites add column if not exists sent_at    timestamptz;
create index if not exists invites_email on public.invites (lower(email));

-- ---------------------------------------------------------------- chats
create table if not exists public.conversations (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('direct','group')),
  name        text,                       -- groups only
  c1          text, c2 text,              -- group colours
  avatar_path text,                       -- group picture
  direct_key  text unique,                -- direct chats only: the two ids sorted, so a pair has one chat
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  pinned          boolean not null default false,
  muted           boolean not null default false,
  last_read_at    timestamptz not null default now(),
  joined_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists members_user on public.conversation_members (user_id);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid references public.profiles(id) on delete set null,   -- null = system note
  type            text not null check (type in ('text','image','file','gif','link','system')),
  text            text not null default '',
  -- type-specific extras:
  --   image  {"images":[{"path":"<conv>/<file>","name":"sunset.jpg","w":1200,"h":800}]}
  --   file   {"file":{"path":"...","name":"menu.pdf","size":2048}}
  --   gif    {"gif":{"label":"celebration","emoji":"🎉"}}
  --   link   {"link":{"title":"...","domain":"...","url":"..."}}
  --   system {"icon":"phone"}
  payload         jsonb not null default '{}'::jsonb,
  reply_to        uuid references public.messages(id) on delete set null,
  client_id       text,                    -- the app's own id, so a retried send never doubles up
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz
);
create index if not exists messages_conv_time on public.messages (conversation_id, created_at desc);
create index if not exists messages_text_trgm on public.messages using gin (text gin_trgm_ops);
create unique index if not exists messages_client on public.messages (sender_id, client_id) where client_id is not null;

create table if not exists public.reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

-- ---------------------------------------------------------------- calls
create table if not exists public.call_sessions (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  started_by      uuid references public.profiles(id) on delete set null,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz
);
create unique index if not exists one_live_call_per_chat on public.call_sessions (conversation_id) where ended_at is null;

create table if not exists public.call_participants (
  session_id uuid not null references public.call_sessions(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  muted      boolean not null default false,
  camera     boolean not null default false,
  sharing    boolean not null default false,
  primary key (session_id, user_id)
);

-- Someone ringing someone else (one-to-one calls only).
create table if not exists public.rings (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id       uuid not null references public.profiles(id) on delete cascade,
  callee_id       uuid not null references public.profiles(id) on delete cascade,
  kind            text not null check (kind in ('audio','video')),
  status          text not null default 'ringing' check (status in ('ringing','answered','declined','cancelled','missed','dnd')),
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------- Tell the Tower
create table if not exists public.ideas (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid references public.profiles(id) on delete set null,
  type       text not null default 'idea' check (type in ('idea','bug')),
  text       text not null,
  status     text not null default 'new' check (status in ('new','planned','done','declined')),
  created_at timestamptz not null default now()
);
create table if not exists public.idea_plus (
  idea_id uuid not null references public.ideas(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (idea_id, user_id)
);
create table if not exists public.idea_comments (
  id         uuid primary key default gen_random_uuid(),
  idea_id    uuid not null references public.ideas(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  text       text not null,
  created_at timestamptz not null default now()
);

-- ================================================================ helpers
create or replace function public.is_member(conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members m where m.conversation_id = conv and m.user_id = auth.uid());
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_owner from public.profiles p where p.id = auth.uid()), false);
$$;

-- ================================================================ security rules (RLS)
alter table public.profiles             enable row level security;
alter table public.invites              enable row level security;
alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;
alter table public.reactions            enable row level security;
alter table public.call_sessions        enable row level security;
alter table public.call_participants    enable row level security;
alter table public.rings                enable row level security;
alter table public.ideas                enable row level security;
alter table public.idea_plus            enable row level security;
alter table public.idea_comments        enable row level security;

drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_read   on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid() and is_owner = (select p.is_owner from public.profiles p where p.id = auth.uid()));

-- invites: only the owner can see or make them. Everyone else goes through redeem_invite().
drop policy if exists invites_owner on public.invites;
create policy invites_owner on public.invites for all to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists conv_read on public.conversations;
create policy conv_read on public.conversations for select to authenticated using (public.is_member(id));
-- Creating and renaming goes through the functions below; direct edits only for group members.
drop policy if exists conv_update on public.conversations;
create policy conv_update on public.conversations for update to authenticated using (public.is_member(id) and type = 'group') with check (public.is_member(id) and type = 'group');

drop policy if exists mem_read on public.conversation_members;
drop policy if exists mem_update_own on public.conversation_members;
create policy mem_read on public.conversation_members for select to authenticated using (public.is_member(conversation_id));
create policy mem_update_own on public.conversation_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists msg_read on public.messages;
drop policy if exists msg_insert on public.messages;
drop policy if exists msg_update_own on public.messages;
create policy msg_read on public.messages for select to authenticated using (public.is_member(conversation_id));
create policy msg_insert on public.messages for insert to authenticated with check (public.is_member(conversation_id) and sender_id = auth.uid() and type <> 'system');
-- Edit and delete (delete = set deleted_at) your own messages only.
create policy msg_update_own on public.messages for update to authenticated using (sender_id = auth.uid()) with check (sender_id = auth.uid());

drop policy if exists react_read on public.reactions;
drop policy if exists react_write on public.reactions;
drop policy if exists react_delete on public.reactions;
create policy react_read   on public.reactions for select to authenticated using (exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.conversation_id)));
create policy react_write  on public.reactions for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.conversation_id)));
create policy react_delete on public.reactions for delete to authenticated using (user_id = auth.uid());

drop policy if exists call_read on public.call_sessions;
create policy call_read on public.call_sessions for select to authenticated using (public.is_member(conversation_id));
drop policy if exists callp_read on public.call_participants;
drop policy if exists callp_write on public.call_participants;
create policy callp_read  on public.call_participants for select to authenticated using (exists (select 1 from public.call_sessions s where s.id = session_id and public.is_member(s.conversation_id)));
create policy callp_write on public.call_participants for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists ring_read on public.rings;
drop policy if exists ring_insert on public.rings;
drop policy if exists ring_update on public.rings;
create policy ring_read   on public.rings for select to authenticated using (caller_id = auth.uid() or callee_id = auth.uid());
create policy ring_insert on public.rings for insert to authenticated with check (caller_id = auth.uid() and public.is_member(conversation_id));
create policy ring_update on public.rings for update to authenticated using (caller_id = auth.uid() or callee_id = auth.uid()) with check (caller_id = auth.uid() or callee_id = auth.uid());

drop policy if exists ideas_read on public.ideas;
drop policy if exists ideas_insert on public.ideas;
drop policy if exists ideas_status on public.ideas;
create policy ideas_read   on public.ideas for select to authenticated using (true);
create policy ideas_insert on public.ideas for insert to authenticated with check (author_id = auth.uid() and status = 'new');
create policy ideas_status on public.ideas for update to authenticated using (public.is_owner()) with check (public.is_owner());

drop policy if exists plus_read on public.idea_plus;
drop policy if exists plus_write on public.idea_plus;
drop policy if exists plus_delete on public.idea_plus;
create policy plus_read   on public.idea_plus for select to authenticated using (true);
create policy plus_write  on public.idea_plus for insert to authenticated with check (user_id = auth.uid());
create policy plus_delete on public.idea_plus for delete to authenticated using (user_id = auth.uid());

drop policy if exists icom_read on public.idea_comments;
drop policy if exists icom_write on public.idea_comments;
create policy icom_read  on public.idea_comments for select to authenticated using (true);
create policy icom_write on public.idea_comments for insert to authenticated with check (author_id = auth.uid());

-- ================================================================ functions the app calls (RPC)

-- After sign-in (anonymous or otherwise), the app calls this once with the invite code and a display name.
-- The very first person to ever redeem becomes the owner.
create or replace function public.redeem_invite(p_code text, p_name text, p_c1 text default null, p_c2 text default null)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); inv public.invites; prof public.profiles; first_user boolean;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  select * into prof from public.profiles where id = uid;
  if found then return prof; end if;                      -- already has an account
  p_name := btrim(coalesce(p_name, ''));
  if p_name = '' then raise exception 'no_name'; end if;
  if exists (select 1 from public.profiles where lower(name) = lower(p_name)) then raise exception 'name_taken'; end if;
  select not exists (select 1 from public.profiles) into first_user;
  if not first_user then
    select * into inv from public.invites where code = upper(btrim(p_code)) for update;
    if not found or inv.revoked_at is not null or inv.uses >= inv.max_uses or (inv.expires_at is not null and inv.expires_at < now()) then raise exception 'bad_code'; end if;
    -- An email-bound invite only works for the address it was sent to.
    if inv.email is not null and lower(inv.email) <> lower(coalesce((select email from auth.users where id = uid), '')) then raise exception 'bad_code'; end if;
    update public.invites set uses = uses + 1 where code = inv.code;
  end if;
  insert into public.profiles (id, name, is_owner, c1, c2)
  values (uid, p_name, first_user, coalesce(p_c1, '#7C5CFA'), coalesce(p_c2, '#E0549F')) returning * into prof;
  if inv.code is not null then update public.invites set used_by = uid, used_at = now() where code = inv.code; end if;
  return prof;
end $$;

-- Owner only: make a one-time invite for one email address. The send-invite edge function emails the code.
create or replace function public.create_invite(p_email text)
returns public.invites language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); em text := lower(btrim(coalesce(p_email, ''))); inv public.invites; c text;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  if not public.is_owner() then raise exception 'not_owner'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'bad_email'; end if;
  if exists (select 1 from auth.users u join public.profiles p on p.id = u.id where lower(u.email) = em) then raise exception 'already_member'; end if;
  if exists (select 1 from public.invites where lower(email) = em and revoked_at is null and uses < max_uses) then raise exception 'already_invited'; end if;
  loop
    c := 'CNC-' || upper(substr(translate(replace(gen_random_uuid()::text, '-', ''), '01', ''), 1, 6));
    exit when length(c) = 10 and not exists (select 1 from public.invites where code = c);
  end loop;
  insert into public.invites (code, created_by, max_uses, email, expires_at, sent_at)
  values (c, uid, 1, em, now() + interval '14 days', now()) returning * into inv;
  return inv;
end $$;

-- Owner only: cancel an invite that has not been used.
create or replace function public.revoke_invite(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'not_owner'; end if;
  update public.invites set revoked_at = now() where code = upper(btrim(p_code)) and uses = 0 and revoked_at is null;
end $$;

-- Find or make the one-to-one chat with another person.
create or replace function public.open_direct(p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); k text; cid uuid;
begin
  if uid is null or p_other is null or p_other = uid then raise exception 'bad_request'; end if;
  if not exists (select 1 from public.profiles where id = p_other) then raise exception 'no_such_person'; end if;
  k := least(uid::text, p_other::text) || ':' || greatest(uid::text, p_other::text);
  select id into cid from public.conversations where direct_key = k;
  if cid is null then
    insert into public.conversations (type, direct_key, created_by) values ('direct', k, uid) returning id into cid;
    insert into public.conversation_members (conversation_id, user_id) values (cid, uid), (cid, p_other);
    insert into public.messages (conversation_id, sender_id, type, text) values (cid, null, 'system', 'A new chat started');
  end if;
  return cid;
end $$;

create or replace function public.create_group(p_name text, p_members uuid[], p_c1 text default null, p_c2 text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cid uuid; m uuid; nm text;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  select coalesce(nullif(btrim(p_name), ''), string_agg(p.name, ', ')) into nm from public.profiles p where p.id = any(p_members);
  insert into public.conversations (type, name, c1, c2, created_by) values ('group', nm, coalesce(p_c1,'#7C5CFA'), coalesce(p_c2,'#E0549F'), uid) returning id into cid;
  insert into public.conversation_members (conversation_id, user_id) values (cid, uid);
  foreach m in array p_members loop
    if m <> uid and exists (select 1 from public.profiles where id = m) then
      insert into public.conversation_members (conversation_id, user_id) values (cid, m) on conflict do nothing;
    end if;
  end loop;
  insert into public.messages (conversation_id, sender_id, type, text, payload) values (cid, null, 'system', 'You created ' || nm, '{"icon":"users"}');
  return cid;
end $$;

create or replace function public.leave_group(p_conv uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); nm text;
begin
  if not exists (select 1 from public.conversations c where c.id = p_conv and c.type = 'group') or not public.is_member(p_conv) then return false; end if;
  select name into nm from public.profiles where id = uid;
  insert into public.messages (conversation_id, sender_id, type, text, payload) values (p_conv, null, 'system', nm || ' left the group', '{"icon":"log-out"}');
  delete from public.conversation_members where conversation_id = p_conv and user_id = uid;
  return true;
end $$;

-- Mark a chat read: moves your "read up to here" marker to now.
create or replace function public.mark_read(p_conv uuid) returns void
language sql security invoker set search_path = public as $$
  update public.conversation_members set last_read_at = now() where conversation_id = p_conv and user_id = auth.uid();
$$;

-- Your chat list in one go, with unread counts and the latest message.
create or replace function public.my_conversations() returns table (
  id uuid, type text, name text, c1 text, c2 text, avatar_path text, other_id uuid,
  pinned boolean, muted boolean, unread bigint, mention boolean, last_text text, last_type text, last_at timestamptz, last_sender uuid, last_deleted boolean
) language sql stable security invoker set search_path = public as $$
  select c.id, c.type, c.name, c.c1, c.c2, c.avatar_path,
         (select m2.user_id from public.conversation_members m2 where m2.conversation_id = c.id and m2.user_id <> auth.uid() limit 1) as other_id,
         m.pinned, m.muted,
         (select count(*) from public.messages x where x.conversation_id = c.id and x.created_at > m.last_read_at and x.sender_id is distinct from auth.uid() and x.type <> 'system' and x.deleted_at is null) as unread,
         exists (select 1 from public.messages x join public.profiles me on me.id = auth.uid()
                  where x.conversation_id = c.id and x.created_at > m.last_read_at and x.sender_id is distinct from auth.uid() and x.deleted_at is null
                    and (x.text ~* ('(^|\W)@(' || me.name || '|everyone)\y'))) as mention,
         l.text, l.type, l.created_at, l.sender_id, (l.deleted_at is not null)
  from public.conversation_members m
  join public.conversations c on c.id = m.conversation_id
  left join lateral (select x.* from public.messages x where x.conversation_id = c.id and x.type <> 'system' order by x.created_at desc limit 1) l on true
  where m.user_id = auth.uid()
  order by coalesce(l.created_at, c.created_at) desc;
$$;

-- Search everything you are allowed to see. Row security keeps it to your own chats.
create or replace function public.search_all(q text) returns table (
  kind text, conversation_id uuid, message_id uuid, sender_id uuid, created_at timestamptz, title text, snippet text, payload jsonb
) language sql stable security invoker set search_path = public as $$
  with needle as (select '%' || replace(replace(lower(btrim(q)), '%', ''), '_', '') || '%' as p)
  select * from (
    select case when m.type = 'image' then 'photo' when m.type = 'text' then 'message' else m.type end as kind,
           m.conversation_id, m.id, m.sender_id, m.created_at,
           coalesce(m.payload->'file'->>'name', m.payload->'link'->>'title', (select string_agg(i->>'name', ', ') from jsonb_array_elements(m.payload->'images') i), '') as title,
           m.text as snippet, m.payload
    from public.messages m, needle n
    where m.type in ('text','image','file','link') and m.deleted_at is null and length(btrim(q)) > 0
      and (lower(m.text) like n.p or lower(m.payload::text) like n.p)
    order by m.created_at desc limit 200
  ) r;
$$;

-- Call plumbing. The app asks to start or join; the livekit-token function then hands out the pass into the room.
create or replace function public.join_call(p_conv uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); sid uuid;
begin
  if not public.is_member(p_conv) then raise exception 'not_a_member'; end if;
  select id into sid from public.call_sessions where conversation_id = p_conv and ended_at is null;
  if sid is null then
    insert into public.call_sessions (conversation_id, started_by) values (p_conv, uid) returning id into sid;
  end if;
  insert into public.call_participants (session_id, user_id) values (sid, uid)
  on conflict (session_id, user_id) do update set left_at = null, joined_at = now(), muted = false, camera = false, sharing = false;
  return sid;
end $$;

create or replace function public.leave_call(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); sid uuid; secs int; kind text; started timestamptz; left_n int;
begin
  select id, started_at into sid, started from public.call_sessions where conversation_id = p_conv and ended_at is null;
  if sid is null then return; end if;
  update public.call_participants set left_at = now() where session_id = sid and user_id = uid;
  select count(*) into left_n from public.call_participants where session_id = sid and left_at is null;
  select type into kind from public.conversations where id = p_conv;
  -- A group call ends when the last person leaves. A one-to-one call ends when either person leaves.
  if left_n = 0 or kind = 'direct' then
    update public.call_sessions set ended_at = now() where id = sid;
    update public.call_participants set left_at = now() where session_id = sid and left_at is null;
    if kind = 'direct' then
      secs := greatest(1, extract(epoch from (now() - started))::int);
      insert into public.messages (conversation_id, sender_id, type, text, payload)
      values (p_conv, null, 'system', 'Call ended · ' || (secs / 60) || ':' || lpad((secs % 60)::text, 2, '0'), '{"icon":"phone"}');
    end if;
  end if;
end $$;

-- Cleans up after a crash: anyone "in a call" with no sign of life for 90 seconds is treated as having left.
create or replace function public.touch_call(p_conv uuid, p_muted boolean default null, p_camera boolean default null, p_sharing boolean default null) returns void
language sql security definer set search_path = public as $$
  update public.call_participants p set
    muted = coalesce(p_muted, p.muted), camera = coalesce(p_camera, p.camera), sharing = coalesce(p_sharing, p.sharing)
  from public.call_sessions s where s.id = p.session_id and s.conversation_id = p_conv and s.ended_at is null and p.user_id = auth.uid() and public.is_member(p_conv);
$$;

grant execute on function public.redeem_invite(text, text, text, text) to authenticated;
grant execute on function public.open_direct(uuid), public.create_group(text, uuid[], text, text), public.leave_group(uuid), public.mark_read(uuid),
  public.my_conversations(), public.search_all(text), public.join_call(uuid), public.leave_call(uuid), public.touch_call(uuid, boolean, boolean, boolean) to authenticated;

-- ================================================================ live updates
-- Tells Supabase which tables to broadcast changes for (this is how new messages appear instantly).
do $$ begin
  begin alter publication supabase_realtime add table public.messages;           exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.reactions;          exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.conversation_members; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.call_participants;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.call_sessions;      exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.rings;              exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.profiles;           exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.ideas;              exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.idea_plus;          exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.idea_comments;      exception when duplicate_object then null; end;
exception when undefined_object then null; end $$;

-- ================================================================ file storage
insert into storage.buckets (id, name, public) values ('attachments', 'attachments', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;

-- Attachments live at <conversation id>/<file>. Only members of that chat can read or add.
drop policy if exists att_read  on storage.objects;
drop policy if exists att_write on storage.objects;
create policy att_read  on storage.objects for select to authenticated using (bucket_id = 'attachments' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy att_write on storage.objects for insert to authenticated with check (bucket_id = 'attachments' and public.is_member(((storage.foldername(name))[1])::uuid));
-- Avatars live at <your id>/<file>. Anyone can look; only you can change yours.
drop policy if exists av_read  on storage.objects;
drop policy if exists av_write on storage.objects;
drop policy if exists av_update on storage.objects;
create policy av_read   on storage.objects for select using (bucket_id = 'avatars');
create policy av_write  on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy av_update on storage.objects for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ================================================================ small additions (v0.12)
-- Group changes (rename, new picture) leave a note in the thread. People cannot insert system rows themselves,
-- so this member-only function does it.
create or replace function public.add_system_note(p_conv uuid, p_text text, p_icon text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_conv) then raise exception 'not_a_member'; end if;
  insert into public.messages (conversation_id, sender_id, type, text, payload)
  values (p_conv, null, 'system', left(coalesce(p_text, ''), 300), jsonb_build_object('icon', coalesce(p_icon, 'pencil')));
end $$;
grant execute on function public.add_system_note(uuid, text, text) to authenticated;

-- ================================================================ calls (v0.13)
-- Heartbeat: every person in a call pings touch_call about every 30 s. Anyone silent for 90 s is treated as gone
-- (crash, closed laptop). Whoever pings next cleans up, so no background job is needed.
alter table public.call_participants add column if not exists last_seen timestamptz not null default now();

create or replace function public.reap_calls() returns void language plpgsql security definer set search_path = public as $$
begin
  update public.call_participants set left_at = now() where left_at is null and last_seen < now() - interval '90 seconds';
  update public.call_sessions s set ended_at = now() where ended_at is null and not exists (
    select 1 from public.call_participants p where p.session_id = s.id and p.left_at is null);
end $$;

create or replace function public.join_call(p_conv uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); sid uuid;
begin
  if not public.is_member(p_conv) then raise exception 'not_a_member'; end if;
  perform public.reap_calls();
  select id into sid from public.call_sessions where conversation_id = p_conv and ended_at is null;
  if sid is null then
    insert into public.call_sessions (conversation_id, started_by) values (p_conv, uid) returning id into sid;
  end if;
  insert into public.call_participants (session_id, user_id) values (sid, uid)
  on conflict (session_id, user_id) do update set left_at = null, joined_at = now(), last_seen = now(), muted = false, camera = false, sharing = false;
  return sid;
end $$;

create or replace function public.touch_call(p_conv uuid, p_muted boolean default null, p_camera boolean default null, p_sharing boolean default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.reap_calls();
  update public.call_participants p set
    muted = coalesce(p_muted, p.muted), camera = coalesce(p_camera, p.camera), sharing = coalesce(p_sharing, p.sharing), last_seen = now()
  from public.call_sessions s where s.id = p.session_id and s.conversation_id = p_conv and s.ended_at is null and p.user_id = auth.uid()
    and p.left_at is null and public.is_member(p_conv);
end $$;

-- Ringing (one-to-one). The caller's app creates the ring; the other person's app hears it live.
create or replace function public.create_ring(p_conv uuid, p_kind text) returns public.rings
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); other uuid; r public.rings; their_status text; mine text;
begin
  if not public.is_member(p_conv) then raise exception 'not_a_member'; end if;
  if p_kind not in ('audio','video') then raise exception 'bad_kind'; end if;
  select user_id into other from public.conversation_members m join public.conversations c on c.id = m.conversation_id
    where m.conversation_id = p_conv and c.type = 'direct' and m.user_id <> uid;
  if other is null then raise exception 'not_direct'; end if;
  update public.rings set status = 'missed' where status = 'ringing' and (caller_id = uid or callee_id = uid) and created_at < now() - interval '60 seconds';
  select status into their_status from public.profiles where id = other;
  select name into mine from public.profiles where id = uid;
  if their_status = 'dnd' then
    insert into public.rings (conversation_id, caller_id, callee_id, kind, status) values (p_conv, uid, other, p_kind, 'dnd') returning * into r;
    insert into public.messages (conversation_id, sender_id, type, text, payload)
    values (p_conv, null, 'system', 'Missed ' || case when p_kind = 'video' then 'video' else 'voice' end || ' call from ' || mine || ' (you were on Do not disturb)', '{"icon":"phone"}');
  else
    insert into public.rings (conversation_id, caller_id, callee_id, kind) values (p_conv, uid, other, p_kind) returning * into r;
  end if;
  return r;
end $$;

-- answered / declined (callee) · cancelled (caller). Only changes a ring that is still ringing.
create or replace function public.end_ring(p_ring uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if p_status not in ('answered','declined','cancelled') then raise exception 'bad_status'; end if;
  update public.rings set status = p_status where id = p_ring and status = 'ringing'
    and ((p_status = 'cancelled' and caller_id = uid) or (p_status in ('answered','declined') and callee_id = uid));
end $$;

-- Nobody picked up. Leaves a "Missed call" note in the chat. Either person's app may call this once 25 s have passed.
create or replace function public.miss_ring(p_ring uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.rings; mine text;
begin
  select * into r from public.rings where id = p_ring and status = 'ringing' and (caller_id = uid or callee_id = uid) and created_at < now() - interval '25 seconds';
  if not found then return; end if;
  update public.rings set status = 'missed' where id = r.id;
  select name into mine from public.profiles where id = r.caller_id;
  insert into public.messages (conversation_id, sender_id, type, text, payload)
  values (r.conversation_id, null, 'system', 'Missed ' || case when r.kind = 'video' then 'video' else 'voice' end || ' call from ' || mine, '{"icon":"phone"}');
end $$;

grant execute on function public.reap_calls() to authenticated;
grant execute on function public.create_ring(uuid, text), public.end_ring(uuid, text), public.miss_ring(uuid) to authenticated;

-- ================================================================ housekeeping (v0.15)
-- Hide a chat from your own list, remove someone from a group, remove a person from Concorde.
alter table public.conversation_members add column if not exists hidden boolean not null default false;

-- A hidden chat comes back by itself when anyone writes in it.
create or replace function public.unhide_on_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type <> 'system' then
    update public.conversation_members set hidden = false where conversation_id = new.conversation_id and hidden;
  end if;
  return new;
end $$;
drop trigger if exists messages_unhide on public.messages;
create trigger messages_unhide after insert on public.messages for each row execute function public.unhide_on_message();

-- Same list as before, minus chats you hid.
create or replace function public.my_conversations() returns table (
  id uuid, type text, name text, c1 text, c2 text, avatar_path text, other_id uuid,
  pinned boolean, muted boolean, unread bigint, mention boolean, last_text text, last_type text, last_at timestamptz, last_sender uuid, last_deleted boolean
) language sql stable security invoker set search_path = public as $$
  select c.id, c.type, c.name, c.c1, c.c2, c.avatar_path,
         (select m2.user_id from public.conversation_members m2 where m2.conversation_id = c.id and m2.user_id <> auth.uid() limit 1) as other_id,
         m.pinned, m.muted,
         (select count(*) from public.messages x where x.conversation_id = c.id and x.created_at > m.last_read_at and x.sender_id is distinct from auth.uid() and x.type <> 'system' and x.deleted_at is null) as unread,
         exists (select 1 from public.messages x join public.profiles me on me.id = auth.uid()
                  where x.conversation_id = c.id and x.created_at > m.last_read_at and x.sender_id is distinct from auth.uid() and x.deleted_at is null
                    and (x.text ~* ('(^|\W)@(' || me.name || '|everyone)\y'))) as mention,
         l.text, l.type, l.created_at, l.sender_id, (l.deleted_at is not null)
  from public.conversation_members m
  join public.conversations c on c.id = m.conversation_id
  left join lateral (select x.* from public.messages x where x.conversation_id = c.id and x.type <> 'system' order by x.created_at desc limit 1) l on true
  where m.user_id = auth.uid() and not m.hidden
  order by coalesce(l.created_at, c.created_at) desc;
$$;

-- Starting a chat with someone you hid brings the old chat back.
create or replace function public.open_direct(p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); k text; cid uuid;
begin
  if uid is null or p_other is null or p_other = uid then raise exception 'bad_request'; end if;
  if not exists (select 1 from public.profiles where id = p_other) then raise exception 'no_such_person'; end if;
  k := least(uid::text, p_other::text) || ':' || greatest(uid::text, p_other::text);
  select id into cid from public.conversations where direct_key = k;
  if cid is null then
    insert into public.conversations (type, direct_key, created_by) values ('direct', k, uid) returning id into cid;
    insert into public.conversation_members (conversation_id, user_id) values (cid, uid), (cid, p_other);
    insert into public.messages (conversation_id, sender_id, type, text) values (cid, null, 'system', 'A new chat started');
  else
    update public.conversation_members set hidden = false where conversation_id = cid and user_id = uid;
  end if;
  return cid;
end $$;

-- Hide a one-to-one chat from your list (the other person keeps theirs).
create or replace function public.hide_chat(p_conv uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.conversations c where c.id = p_conv and c.type = 'direct') or not public.is_member(p_conv) then return false; end if;
  update public.conversation_members set hidden = true where conversation_id = p_conv and user_id = auth.uid();
  return true;
end $$;

-- The owner (or whoever made the group) removes someone from a group.
create or replace function public.remove_member(p_conv uuid, p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); nm text;
begin
  if p_user = uid then return false; end if;
  if not exists (select 1 from public.conversations c where c.id = p_conv and c.type = 'group'
                  and (public.is_owner() or c.created_by = uid)) then return false; end if;
  if not exists (select 1 from public.conversation_members where conversation_id = p_conv and user_id = p_user) then return false; end if;
  select name into nm from public.profiles where id = p_user;
  insert into public.messages (conversation_id, sender_id, type, text, payload) values (p_conv, null, 'system', nm || ' was removed from the group', '{"icon":"log-out"}');
  delete from public.conversation_members where conversation_id = p_conv and user_id = p_user;
  return true;
end $$;

-- The owner removes a person from Concorde completely: their account, their one-to-one chats and their messages.
-- They can come back later with a fresh invite.
create or replace function public.remove_person(p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); nm text; g record;
begin
  if not public.is_owner() or p_user is null or p_user = uid then return false; end if;
  if coalesce((select is_owner from public.profiles where id = p_user), true) then return false; end if;
  select name into nm from public.profiles where id = p_user;
  for g in select m.conversation_id from public.conversation_members m join public.conversations c on c.id = m.conversation_id
            where m.user_id = p_user and c.type = 'group' loop
    insert into public.messages (conversation_id, sender_id, type, text, payload) values (g.conversation_id, null, 'system', nm || ' was removed from Concorde', '{"icon":"log-out"}');
  end loop;
  delete from public.messages where sender_id = p_user;
  delete from public.conversations where id in (
    select m.conversation_id from public.conversation_members m join public.conversations c on c.id = m.conversation_id
     where m.user_id = p_user and c.type = 'direct');
  delete from auth.users where id = p_user;
  return true;
end $$;

grant execute on function public.hide_chat(uuid), public.remove_member(uuid, uuid), public.remove_person(uuid) to authenticated;

-- ================================================================ v0.16
-- Custom status message (words or an emoji) shown under a person's name.
alter table public.profiles add column if not exists status_text text;
do $$ begin
  alter table public.profiles add constraint profiles_status_text_len check (status_text is null or char_length(status_text) <= 60);
exception when duplicate_object then null; end $$;

-- ================================================================ Tell the Tower screenshots (v0.16)
alter table public.ideas add column if not exists images jsonb not null default '[]'::jsonb;
insert into storage.buckets (id, name, public) values ('tower', 'tower', true) on conflict (id) do nothing;
drop policy if exists tw_read  on storage.objects;
drop policy if exists tw_write on storage.objects;
create policy tw_read  on storage.objects for select using (bucket_id = 'tower');
create policy tw_write on storage.objects for insert to authenticated with check (bucket_id = 'tower' and (storage.foldername(name))[1] = auth.uid()::text);

-- ================================================================ pokes (v0.18)
-- A poke is a tiny "hey". The person gets a shake, a boop and a desktop alert. Rows only live a day.
create table if not exists public.pokes (
  id         uuid primary key default gen_random_uuid(),
  from_id    uuid not null references public.profiles(id) on delete cascade,
  to_id      uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.pokes enable row level security;
drop policy if exists pokes_read on public.pokes;
create policy pokes_read on public.pokes for select to authenticated using (to_id = auth.uid() or from_id = auth.uid());
-- Nobody inserts directly; poke() does it, so the pace limit below can't be skipped.
create or replace function public.poke(p_to uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null or p_to is null or p_to = uid then return false; end if;
  if not exists (select 1 from public.profiles where id = p_to) then return false; end if;
  -- at most one poke every 8 seconds per person
  if exists (select 1 from public.pokes where from_id = uid and to_id = p_to and created_at > now() - interval '8 seconds') then return false; end if;
  delete from public.pokes where created_at < now() - interval '1 day';
  insert into public.pokes (from_id, to_id) values (uid, p_to);
  return true;
end $$;
grant execute on function public.poke(uuid) to authenticated;
do $$ begin
  begin alter publication supabase_realtime add table public.pokes; exception when duplicate_object then null; when undefined_object then null; end;
end $$;
