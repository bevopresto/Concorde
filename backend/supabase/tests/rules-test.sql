\set ON_ERROR_STOP on
truncate auth.users cascade; delete from public.invites;
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c'),('00000000-0000-0000-0000-00000000000d');
create or replace function t_as(u text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u, false); end $$;
create or replace function t_expect_fail(sql text, needle text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if position(needle in sqlerrm) > 0 or needle = '' then return; end if;
    raise exception 'wrong error for %: %', sql, sqlerrm; end;
  raise exception 'expected failure but it worked: %', sql;
end $$;
grant execute on all functions in schema public to authenticated;

-- A is first: becomes owner, no code needed
select t_as('00000000-0000-0000-0000-00000000000a');
set role authenticated;
select (public.redeem_invite('', 'Bev')).is_owner as a_is_owner;
reset role;
insert into public.invites (code, created_by, max_uses) values ('CNC-2026', '00000000-0000-0000-0000-00000000000a', 2);

-- B and C join, D is the third use and must fail; wrong code fails; name clash fails
set role authenticated;
select t_as('00000000-0000-0000-0000-00000000000b'); select t_expect_fail($$select public.redeem_invite('WRONG','Ben')$$, 'bad_code');
select t_expect_fail($$select public.redeem_invite('cnc-2026','bev')$$, 'name_taken');
select (public.redeem_invite('cnc-2026','Ben')).is_owner as b_is_owner;
select t_as('00000000-0000-0000-0000-00000000000c'); select (public.redeem_invite('CNC-2026','Plush')).name as c_name;
select t_as('00000000-0000-0000-0000-00000000000d'); select t_expect_fail($$select public.redeem_invite('CNC-2026','Kid')$$, 'bad_code');
-- non-owner cannot read invites or promote self
select t_as('00000000-0000-0000-0000-00000000000b');
select count(*) as b_sees_invites from public.invites;
select t_expect_fail($$update public.profiles set is_owner = true where id = '00000000-0000-0000-0000-00000000000b'$$, 'row-level security');
reset role;
select is_owner as b_still_not_owner from public.profiles where name = 'Ben';

-- direct chat: B opens with C, C opens with B -> same chat; A cannot see it
set role authenticated;
select t_as('00000000-0000-0000-0000-00000000000b');
select public.open_direct('00000000-0000-0000-0000-00000000000c') as dm \gset
select t_as('00000000-0000-0000-0000-00000000000c');
select (public.open_direct('00000000-0000-0000-0000-00000000000b') = :'dm'::uuid) as same_dm;
select t_as('00000000-0000-0000-0000-00000000000a');
select count(*) as a_sees_dm from public.conversations where id = :'dm'::uuid;
select t_expect_fail($$insert into public.messages (conversation_id, sender_id, type, text) values ('$$ || :'dm' || $$', '00000000-0000-0000-0000-00000000000a', 'text', 'sneaky')$$, 'row-level security');

-- B sends messages; spoofing C fails; system messages by users fail; C sees; retry with same client_id is rejected as duplicate
select t_as('00000000-0000-0000-0000-00000000000b');
insert into public.messages (conversation_id, sender_id, type, text, client_id) values (:'dm'::uuid, '00000000-0000-0000-0000-00000000000b', 'text', 'hello @Plush', 'c1');
select t_expect_fail($$insert into public.messages (conversation_id, sender_id, type, text) values ('$$ || :'dm' || $$', '00000000-0000-0000-0000-00000000000c', 'text', 'spoof')$$, 'row-level security');
select t_expect_fail($$insert into public.messages (conversation_id, sender_id, type, text) values ('$$ || :'dm' || $$', '00000000-0000-0000-0000-00000000000b', 'system', 'fake system')$$, 'row-level security');
select t_expect_fail($$insert into public.messages (conversation_id, sender_id, type, text, client_id) values ('$$ || :'dm' || $$', '00000000-0000-0000-0000-00000000000b', 'text', 'dup', 'c1')$$, 'duplicate');
insert into public.messages (conversation_id, sender_id, type, text, payload) values (:'dm'::uuid, '00000000-0000-0000-0000-00000000000b', 'image', 'look', '{"images":[{"path":"x/y","name":"Sunset over Bondi.png"}]}');

-- C: unread count, mention flag, preview; then mark_read clears
select t_as('00000000-0000-0000-0000-00000000000c');
select unread, mention, last_type from public.my_conversations();
select kind, title from public.search_all('bondi');
select kind, snippet from public.search_all('hello');
select public.mark_read(:'dm'::uuid);
select unread, mention from public.my_conversations();
-- C cannot edit B's message but can react; B can soft-delete own
update public.messages set text = 'hacked' where sender_id = '00000000-0000-0000-0000-00000000000b';
select count(*) as c_edited_bs from public.messages where text = 'hacked';
insert into public.reactions (message_id, user_id, emoji) select id, '00000000-0000-0000-0000-00000000000c', '👍' from public.messages where client_id = 'c1';

-- group + leave + outsider (A) cannot read
select t_as('00000000-0000-0000-0000-00000000000b');
select public.create_group('', array['00000000-0000-0000-0000-00000000000c'::uuid,'00000000-0000-0000-0000-00000000000a'::uuid], null, null) as grp \gset
select name, (select count(*) from public.conversation_members m where m.conversation_id = c.id) as members from public.conversations c where id = :'grp'::uuid;
select t_as('00000000-0000-0000-0000-00000000000a'); select public.leave_group(:'grp'::uuid) as a_left;
select count(*) as a_sees_group_after_leaving from public.conversations where id = :'grp'::uuid;

-- calls: B joins, C joins (group of 2 in a direct), leave ends direct call and drops a system note
select t_as('00000000-0000-0000-0000-00000000000b'); select public.join_call(:'dm'::uuid) is not null as b_joined;
select t_as('00000000-0000-0000-0000-00000000000c'); select public.join_call(:'dm'::uuid) is not null as c_joined;
select count(*) as in_call from public.call_participants where left_at is null;
select public.touch_call(:'dm'::uuid, true, false, false);
select t_as('00000000-0000-0000-0000-00000000000a'); select t_expect_fail($$select public.join_call('$$ || :'dm' || $$')$$, 'not_a_member');
select t_as('00000000-0000-0000-0000-00000000000c'); select public.leave_call(:'dm'::uuid);
select count(*) as live_sessions from public.call_sessions where ended_at is null;
select text from public.messages where conversation_id = :'dm'::uuid and type = 'system' order by created_at desc limit 1;

-- tower: anyone posts, only owner sets status
select t_as('00000000-0000-0000-0000-00000000000c');
insert into public.ideas (author_id, text) values ('00000000-0000-0000-0000-00000000000c', 'quiet mode');
update public.ideas set status = 'done';
select status as status_after_nonowner from public.ideas;
select t_as('00000000-0000-0000-0000-00000000000a'); update public.ideas set status = 'planned';
select status as status_after_owner from public.ideas;
-- storage rule: B can store under the dm folder, A cannot
select t_as('00000000-0000-0000-0000-00000000000b');
insert into storage.objects (bucket_id, name) values ('attachments', :'dm' || '/pic.png');
select t_as('00000000-0000-0000-0000-00000000000a');
select t_expect_fail($$insert into storage.objects (bucket_id, name) values ('attachments', '$$ || :'dm' || $$/x.png')$$, 'row-level security');
reset role;
-- ---- email invites (owner only, single use, bound to an address)
reset role;
update auth.users set email = 'ben@x.com' where id = '00000000-0000-0000-0000-00000000000b';
update auth.users set email = 'plush@x.com' where id = '00000000-0000-0000-0000-00000000000c';
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000e', 'new@x.com'), ('00000000-0000-0000-0000-00000000000f', 'other@x.com');
set role authenticated;
select t_as('00000000-0000-0000-0000-00000000000b'); select t_expect_fail($$select public.create_invite('x@y.com')$$, 'not_owner');
select t_expect_fail($$select public.revoke_invite('CNC-2026')$$, 'not_owner');
select t_as('00000000-0000-0000-0000-00000000000a');
select t_expect_fail($$select public.create_invite('nope')$$, 'bad_email');
select t_expect_fail($$select public.create_invite('ben@x.com')$$, 'already_member');
select (public.create_invite('New@x.com')).code as made_code \gset
select :'made_code' ~ '^CNC-[A-Z2-9]{6}$' as code_shape;
select t_expect_fail($$select public.create_invite('new@x.com')$$, 'already_invited');
-- wrong person cannot use it
select t_as('00000000-0000-0000-0000-00000000000f');
select t_expect_fail(format('select public.redeem_invite(%L, %L)', :'made_code', 'Other'), 'bad_code');
-- right person can, once
select t_as('00000000-0000-0000-0000-00000000000e');
select (public.redeem_invite(:'made_code', 'Newbie')).name as e_name;
reset role;
select used_by is not null as marked_used from public.invites where code = :'made_code';
set role authenticated;
-- revoke: a cancelled invite no longer works
select t_as('00000000-0000-0000-0000-00000000000a');
select (public.create_invite('later@x.com')).code as code2 \gset
select public.revoke_invite(:'code2');
reset role; insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000010', 'later@x.com'); set role authenticated;
select t_as('00000000-0000-0000-0000-000000000010');
select t_expect_fail(format('select public.redeem_invite(%L, %L)', :'code2', 'Later'), 'bad_code');

-- ---- calls (v0.13): join, heartbeat reaping, rings
reset role;
create or replace function t_assert(ok boolean, what text) returns void language plpgsql as $$ begin if not coalesce(ok,false) then raise exception 'FAILED: %', what; end if; end $$;
grant execute on function t_assert(boolean, text) to authenticated;
set role authenticated;
select t_as('00000000-0000-0000-0000-00000000000a');
select (public.open_direct('00000000-0000-0000-0000-00000000000b')) as dm \gset
select public.join_call(:'dm'::uuid) is not null as a_joined;
select t_as('00000000-0000-0000-0000-00000000000b');
select public.join_call(:'dm'::uuid) is not null as b_joined;
reset role;
select t_assert((select count(*) from public.call_participants where left_at is null) = 2, 'two people in the call');
update public.call_participants set last_seen = now() - interval '2 minutes' where user_id = '00000000-0000-0000-0000-00000000000a';
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000b');
select public.touch_call(:'dm'::uuid, true, null, null);
reset role;
select t_assert((select count(*) from public.call_participants where left_at is null) = 1, 'silent person was reaped');
select t_assert((select muted from public.call_participants where user_id = '00000000-0000-0000-0000-00000000000b' and left_at is null), 'mute state saved');
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000c');
select t_expect_fail(format('select public.join_call(%L)', :'dm'), 'not_a_member');
-- rings: A rings B; a stranger cannot answer; B declines; a second ring then goes unanswered
reset role; update public.call_sessions set ended_at = now() where ended_at is null; set role authenticated;
select t_as('00000000-0000-0000-0000-00000000000a');
select (public.create_ring(:'dm'::uuid, 'video')).id as ring1 \gset
select t_as('00000000-0000-0000-0000-00000000000c');
select public.end_ring(:'ring1'::uuid, 'declined');
reset role;
select t_assert((select status from public.rings where id = :'ring1') = 'ringing', 'stranger cannot decline');
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000b');
select public.end_ring(:'ring1'::uuid, 'declined');
reset role;
select t_assert((select status from public.rings where id = :'ring1') = 'declined', 'callee declined');
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000a');
select (public.create_ring(:'dm'::uuid, 'audio')).id as ring2 \gset
select public.miss_ring(:'ring2'::uuid);
reset role;
select t_assert((select status from public.rings where id = :'ring2') = 'ringing', 'too early to call it missed');
update public.rings set created_at = now() - interval '40 seconds' where id = :'ring2';
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000a');
select public.miss_ring(:'ring2'::uuid);
reset role;
select t_assert((select status from public.rings where id = :'ring2') = 'missed', 'unanswered ring marked missed');
select t_assert((select count(*) from public.messages where conversation_id = :'dm' and text like 'Missed voice call%') = 1, 'missed-call note left in chat');
-- Do not disturb: callee never rings, note says so
update public.profiles set status = 'dnd' where id = '00000000-0000-0000-0000-00000000000b';
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000a');
select (public.create_ring(:'dm'::uuid, 'video')).status as dnd_status;
reset role;
select t_assert((select count(*) from public.messages where conversation_id = :'dm' and text like '%Do not disturb%') = 1, 'dnd note');


-- ---- housekeeping (v0.15): hide chat, remove from group, remove person
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000a');
select public.create_group('Crew', array['00000000-0000-0000-0000-00000000000b'::uuid,'00000000-0000-0000-0000-00000000000c'::uuid], null, null) as crew \gset
select public.hide_chat(:'dm'::uuid) as hid \gset
select t_assert(:'hid' = 't', 'hide_chat works on a direct chat');
select t_assert((select count(*) from public.my_conversations() where id = :'dm') = 0, 'hidden chat leaves my list');
select public.hide_chat(:'crew'::uuid) as hidg \gset
select t_assert(:'hidg' = 'f', 'groups cannot be hidden (leave instead)');
select t_as('00000000-0000-0000-0000-00000000000b');
select t_assert((select count(*) from public.my_conversations() where id = :'dm') = 1, 'other person still sees the chat');
reset role;
insert into public.messages (conversation_id, sender_id, type, text) values (:'dm', '00000000-0000-0000-0000-00000000000b', 'text', 'hello again');
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000a');
select t_assert((select count(*) from public.my_conversations() where id = :'dm') = 1, 'chat returns when someone writes');
select public.hide_chat(:'dm'::uuid);
select public.open_direct('00000000-0000-0000-0000-00000000000b'::uuid);
select t_assert((select count(*) from public.my_conversations() where id = :'dm') = 1, 'starting a chat again unhides it');
select t_as('00000000-0000-0000-0000-00000000000b');
select public.remove_member(:'crew'::uuid, '00000000-0000-0000-0000-00000000000c'::uuid) as rm1 \gset
select t_assert(:'rm1' = 'f', 'a normal member cannot remove someone');
select t_as('00000000-0000-0000-0000-00000000000a');
select public.remove_member(:'crew'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as rm2 \gset
select t_assert(:'rm2' = 'f', 'cannot remove yourself that way');
select public.remove_member(:'crew'::uuid, '00000000-0000-0000-0000-00000000000c'::uuid) as rm3 \gset
select t_assert(:'rm3' = 't', 'owner removes a member');
reset role;
select t_assert(not exists (select 1 from public.conversation_members where conversation_id = :'crew' and user_id = '00000000-0000-0000-0000-00000000000c'), 'member row gone');
select t_assert(exists (select 1 from public.messages where conversation_id = :'crew' and text like '% was removed from the group'), 'removal note left');
insert into public.messages (conversation_id, sender_id, type, text) values (:'dm', '00000000-0000-0000-0000-00000000000c', 'text', 'x');
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000b');
select public.remove_person('00000000-0000-0000-0000-00000000000c'::uuid) as rp1 \gset
select t_assert(:'rp1' = 'f', 'a normal member cannot remove a person');
select t_as('00000000-0000-0000-0000-00000000000a');
select public.remove_person('00000000-0000-0000-0000-00000000000a'::uuid) as rp2 \gset
select t_assert(:'rp2' = 'f', 'owner cannot remove themselves');
select public.remove_person('00000000-0000-0000-0000-00000000000c'::uuid) as rp3 \gset
select t_assert(:'rp3' = 't', 'owner removes a person');
reset role;
select t_assert(not exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-00000000000c'), 'profile gone');
select t_assert(not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-00000000000c'), 'account gone');
select t_assert(not exists (select 1 from public.messages where sender_id is null and type = 'text'), 'no ghost messages');
select t_assert(not exists (select 1 from public.conversations c where c.type = 'direct' and not exists (select 1 from public.conversation_members m where m.conversation_id = c.id)), 'no empty chats left');

-- pokes
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000a');
select public.poke('00000000-0000-0000-0000-00000000000b'::uuid) as pk1 \gset
select t_assert(:'pk1' = 't', 'a poke goes through');
select public.poke('00000000-0000-0000-0000-00000000000b'::uuid) as pk2 \gset
select t_assert(:'pk2' = 'f', 'a second poke straight away is held back');
select public.poke('00000000-0000-0000-0000-00000000000a'::uuid) as pk3 \gset
select t_assert(:'pk3' = 'f', 'you cannot poke yourself');
select t_assert((select count(*) from public.pokes) = 1, 'sender sees their poke');
select t_as('00000000-0000-0000-0000-00000000000b');
select t_assert((select count(*) from public.pokes) = 1, 'the poked person sees it');
select t_as('00000000-0000-0000-0000-00000000000d');
select t_assert((select count(*) from public.pokes) = 0, 'a bystander sees no pokes');
reset role;

-- custom emoji
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000a');
insert into public.custom_emoji (name, path) values ('partyblob', 'partyblob-1.png');
select t_assert((select count(*) from public.custom_emoji) = 1, 'owner can add an emoji');
select t_expect_fail($$insert into public.custom_emoji (name, path) values ('Bad Name!', 'x.png')$$, 'check');
select t_as('00000000-0000-0000-0000-00000000000b');
select t_assert((select count(*) from public.custom_emoji) = 1, 'everyone can see custom emoji');
select t_expect_fail($$insert into public.custom_emoji (name, path) values ('sneaky', 'x.png')$$, 'row-level security');
delete from public.custom_emoji where name = 'partyblob';
select t_as('00000000-0000-0000-0000-00000000000a');
select t_assert((select count(*) from public.custom_emoji) = 1, 'a non-owner cannot delete an emoji');
reset role;

-- gif library + soundboard
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000a');
insert into public.gif_library (name, path) values ('dance', 'dance.gif');
insert into public.sounds (name, path) values ('airhorn', 'airhorn.mp3');
select t_as('00000000-0000-0000-0000-00000000000b');
select t_assert((select count(*) from public.gif_library) = 1 and (select count(*) from public.sounds) = 1, 'everyone can see library gifs and sounds');
select t_expect_fail($$insert into public.sounds (name, path) values ('sneaky', 'x.mp3')$$, 'row-level security');
select t_expect_fail($$insert into public.gif_library (name, path) values ('sneaky', 'x.gif')$$, 'row-level security');
delete from public.sounds; delete from public.gif_library;
select t_as('00000000-0000-0000-0000-00000000000a');
select t_assert((select count(*) from public.sounds) = 1 and (select count(*) from public.gif_library) = 1, 'a non-owner cannot delete them');
reset role;

-- delete a group (owner only)
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000b');
select public.create_group('Doomed', array['00000000-0000-0000-0000-00000000000c'::uuid,'00000000-0000-0000-0000-00000000000a'::uuid], null, null) as dgrp \gset
insert into public.messages (conversation_id, sender_id, type, text) values (:'dgrp', '00000000-0000-0000-0000-00000000000b', 'text', 'hi');
select t_assert(public.delete_group(:'dgrp') = false, 'a non-owner cannot delete a group');
select t_assert((select count(*) from public.conversations where id = :'dgrp') = 1, 'group still there after refused delete');
select t_as('00000000-0000-0000-0000-00000000000a');
select t_assert(public.delete_group(:'dgrp') = true, 'the owner can delete a group');
reset role;
select t_assert((select count(*) from public.conversations where id = :'dgrp') = 0 and (select count(*) from public.messages where conversation_id = :'dgrp') = 0 and (select count(*) from public.conversation_members where conversation_id = :'dgrp') = 0, 'group, members and messages are all gone');
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000a');
select t_assert(public.delete_group((select id from public.conversations where type = 'direct' limit 1)) = false, 'delete_group refuses a one-to-one chat');
reset role;

-- purge deleted messages
select public.create_group('Tidy', array['00000000-0000-0000-0000-00000000000c'::uuid], null, null) as tgrp \gset
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000b');
reset role;
insert into public.messages (conversation_id, sender_id, type, text, deleted_at) values
  (:'tgrp', '00000000-0000-0000-0000-00000000000b', 'text', 'old gone', now() - interval '2 hours'),
  (:'tgrp', '00000000-0000-0000-0000-00000000000b', 'text', 'fresh gone', now() - interval '5 minutes'),
  (:'tgrp', '00000000-0000-0000-0000-00000000000b', 'text', 'still here', null);
select t_assert(public.purge_deleted_messages() = 1, 'purge removes only the old deleted message');
select t_assert((select count(*) from public.messages where conversation_id = :'tgrp' and type = 'text') = 2, 'recent deletions and normal messages stay');
select t_assert(not has_function_privilege('anon', 'public.purge_deleted_messages(interval)', 'execute'), 'the public cannot run the purge');

-- add people to a group (any member can add anyone)
select t_as('00000000-0000-0000-0000-00000000000b');
select public.create_group('Grow', array['00000000-0000-0000-0000-00000000000e'::uuid], null, null) as ggrp \gset
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000e');
select t_assert(public.add_group_members(:'ggrp', array['00000000-0000-0000-0000-00000000000a'::uuid]) = 1, 'a plain member can add someone');
select t_assert((select count(*) from public.conversation_members where conversation_id = :'ggrp') = 3, 'the new person is now a member');
select t_assert(public.add_group_members(:'ggrp', array['00000000-0000-0000-0000-00000000000a'::uuid]) = 0, 'adding someone already in does nothing');
select t_assert((select count(*) from public.messages where conversation_id = :'ggrp' and type = 'system' and text like '% added %') = 1, 'one note says who was added');
select t_as('00000000-0000-0000-0000-00000000000a');
select t_assert((select count(*) from public.messages where conversation_id = :'ggrp') >= 2, 'the new member can read the whole chat');
reset role;
-- an outsider cannot add people to a group they are not in
select t_as('00000000-0000-0000-0000-00000000000b');
select public.create_group('Closed', array['00000000-0000-0000-0000-00000000000e'::uuid], null, null) as cgrp \gset
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000a');
select t_assert(public.add_group_members(:'cgrp', array['00000000-0000-0000-0000-00000000000a'::uuid]) = 0, 'a non-member cannot add people');
reset role;

\echo ALL-CHECKS-RAN
