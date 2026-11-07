# Concorde services contract

**The rule:** the screens (`js/app.js`, `js/extras.js`, `css/*`) only ever talk to `Concorde.services`.
They never touch data directly. The click-through prototype implements this contract with made-up data
(`js/services.js` + `js/mock-data.js`). The real build replaces those functions, keeping every name, argument
and returned shape below. **The UI is frozen at v0.9.1. Do not edit UI files** except where a section below
says so. If the UI needs to change, stop and tell Bev.

## 1. Conventions

- **Reads that the screens call while drawing are synchronous** (`getPerson`, `getCall`, `getShared`, `getPreview`,
  `listIdeas`, `getRing`, `getConnection`, `getUpdate`, `getCurrentUser`, `isOwner`, `towerUnread`, `mentionsYou`).
  The real adapter must answer them instantly from a local cache and keep that cache fresh from the network.
  Everything that *loads* or *changes* data returns a Promise.
- **`listConversations()` returns one live array.** The screens keep a reference to it, so the adapter must update
  that same array in place (push, splice, replace items) and then emit `conversations`. Never hand back a new array each call.
- **"You" is always the id `'you'`.** In every shape the screens receive, the signed-in person is `'you'`, never their real id.
  The adapter translates real user ids to and from `'you'` at the boundary. Everyone else keeps their real id (a UUID string).
- **Events:** `Concorde.services.on(type, fn)`. Types: `message`, `typing`, `call`, `conversations`, `ring`, `tower`, `update`, `connection`
  (payloads in section 4). Handlers may be called many times; emit after the local cache is updated.
- **Errors:** reject with `{ code, message }`. `message` is a plain sentence a friend could read (it is shown on screen). Codes used so far:
  `offline`, `no-code`, `bad-code`, `name-taken`, `no-name`, `not-a-member`, `unknown`. Never reject with a raw database error.
- **Times:** the screens show `time` (e.g. `'8:30 pm'`, local) and group by `d` (days ago: 0 today, -1 yesterday, -2 …).
  The adapter derives both from the stored timestamp and also keeps `createdAt` (ISO string).
- **Ids** are opaque strings. The prototype's `'hangar'`, `'u12'` are just examples.
- **Prototype-only functions** (names starting `simulate…`, plus `setFriendStatus`, `simulateFirstRun`, `restoreWorld`, `isFirstRun`, `_fakeReply`, `_flush`)
  exist only in the mock. The Prototype tools pane in Settings calls them; in the live build that pane is hidden (config `backend: 'live'`).
  Do not implement them for real.

## 2. Shapes the screens receive

```
Person        { id, name, c1, c2, status: 'online'|'away'|'dnd'|'offline'|'invisible', avatar: url|null }
               // 'invisible' only ever appears on you. A friend who chose "appear offline" is shown as 'offline'.
Conversation  { id, type: 'direct'|'group',
                with,                       // direct: the other person's id
                name, members:[ids incl 'you'], c1, c2, avatar,   // group
                unread: number, mention: boolean, pinned: boolean, muted: boolean,
                call: null | { participants:[ids], sharing: id|null, startedAt: ms, streams:[{id,kind:'camera'|'screen'}] } }
Message       { id, from: id|'system', type: 'text'|'image'|'file'|'gif'|'link'|'system',
                text, time, d, createdAt, replyTo: id|null,
                reactions: [{ emoji, count, mine }],
                deleted?: true, failed?: true,
                // type-specific
                image?: url, images?: [{image: url, name}], name?: string,   // image(s); url must be loadable in an <img> (use signed urls)
                file?: { name, size: '2.4 MB' },
                gif?: { label, emoji },
                link?: { title, domain },
                icon?: string }                                              // system notes
CallState     { conversationId, joined: boolean, participants:[ids], muted: boolean, sharingId: id|null,
                startedAt: ms, streams:[{id, kind}], speakingId: id|null }
Ring          { conversationId, personId, kind: 'audio'|'video', direction: 'in'|'out', status: 'ringing'|'declined'|'dnd' }
Idea          { id, from, type: 'idea'|'bug', text, status: 'new'|'planned'|'done'|'declined',
                plus:[ids], comments:[{from,text}], seen: boolean, time }
SearchResult  { kind: 'chat'|'message'|'photo'|'file'|'link', conversationId, messageId, from, time, d,
                convName, convType, title, text, thumb?: {image|scene,name}, count? }
Update        { available: boolean, version: string|null, installing: boolean }
Connection    { online: boolean, reconnecting: boolean }
```

## 3. Functions

Column "Real implementation" says what the live adapter does. Tables and functions named there are in `supabase/schema.sql`.

### Accounts (workstream A)
| Function | Contract | Real implementation |
|---|---|---|
| `getCurrentUser()` | sync → Person (id `'you'`) | cached own profile |
| `requestCode(email)` | → true. Sends a 6-digit one-time code by email. Rejects `bad-email`, `offline` | `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })` |
| `verifyCode(email, code)` | → `{ isNew }`. `isNew` is true when this person has no profile yet. Rejects `bad-code` (wrong or expired), `offline` | `supabase.auth.verifyOtp({ email, token: code, type: 'email' })`, then check for a `profiles` row. If one exists: load all profiles into the cache, load conversations, emit `conversations`. |
| `joinWithInvite({name, inviteCode})` | → Person. New people only. Rejects `no-name`, `no-code`, `bad-invite`, `name-taken`, `offline` | RPC `redeem_invite`. The mock's `bad-invite`/`bad-code` text lives in the sign-in screen, so map the database's `bad_code` to `bad-invite` here. |
| ~~`signIn`~~ | Removed in v0.10.0 (replaced by the three above) | — |
| `signOut()` | → void | `auth.signOut()`, clear caches, close realtime channels, leave any call |
| `setStatus(status)` | → Person. `'online'\|'away'\|'dnd'\|'invisible'` | update `profiles.status`; broadcast presence |
| `updateProfile({name?, c1?, c2?, avatar?})` | → Person. `avatar` is a data-URL or null | upload to `avatars/<uid>/…`, store path in `profiles.avatar_path`, return public URL |
| `getPerson(id)` | sync → Person or undefined | cache; refresh via realtime on `profiles` |
| `setFriendStatus` | **mock only** | — |

### Status of the live adapter (v0.12.0)
`js/services.supabase.js` implements everything in Accounts, Invites, Conversations, Messages and Tell the Tower. Updates are a stub. Calls and ringing are in `js/services.calls.js` (below). Extra function: `restoreSession()` → Promise<boolean>, called once at start-up to resume a saved sign-in.
Live mode is chosen in `js/config.js`: opening index.html from disk (file://) is live; add `?mock` for the demo data, or `?live` on a web address.
Tests: `tools/v12.js` runs the adapter against an in-memory stand-in (`tools/fake-supabase.js`). Real-database behaviour is checked by Bev's first sign-in.

### Invites (A, owner only)
Only the owner sees the "Invite a friend" tab (`isOwner()` decides). Non-owners must never see it, and the database refuses them anyway.

| Function | Notes |
|---|---|
| `isOwner()` | sync → boolean. From the cached profile. |
| `listInvites()` | sync → live array of `{id, email, status: 'pending'\|'joined'\|'revoked', time}`. `id` is the invite code. Owner only. |
| `sendInvite(email)` | → the new invite. Calls the `send-invite` edge function with `{email}`. Rejects `bad-email`, `already-member`, `already-invited`, `not-owner`, `offline`, `email-failed`. |
| `resendInvite(id)` | → invite. Calls `send-invite` with `{code}`. Rejects `not-pending`, `offline`, `email-failed`. |
| `revokeInvite(id)` | → void. Calls `revoke_invite`. Only pending invites change. |
| `setOwnerView(on)` | Mock only. Never implement for real. |

Event: `invites` (any change to the list). Database: `create_invite`, `revoke_invite`, `redeem_invite` (email-bound codes work once, only for the address they were sent to).

### Conversations (A)
| Function | Contract | Real implementation |
|---|---|---|
| `listConversations()` | → the one live array of Conversation | RPC `my_conversations()` plus members; keep array live (see conventions) |
| `createConversation(memberIds, name?, look?)` | → `{id, created}`. One person = direct chat (reused if exists); several = new group. `look = {c1,c2,avatar}` | RPC `open_direct` or `create_group` |
| `updateConversation(id, {name?, c1?, c2?, avatar?})` | → Conversation. Groups only. Leaves a system note per change | update `conversations`; insert system messages via a small RPC (add one if needed: system rows cannot be inserted by users) |
| `setPinned(id, on)` / `setChatMuted(id, on)` | → Conversation | update own `conversation_members` row |
| `leaveGroup(id)` | → boolean | RPC `leave_group` |
| `markRead(id)` | → void. Zeroes unread and mention | RPC `mark_read` |
| `setViewing(id)` | → void. Tells the service which chat is open (no unread bump for it) | local only |
| `getShared(id)` | sync → `{media:[…], files:[…], links:[…]}` for the details pane | derived from loaded messages of that chat, topped up by a query |
| `getPreview(id)` | sync → `{text, time, from}` last non-system message | from `my_conversations` / cache |
| `mentionsYou(text)` | sync → boolean. Matches `@<your name>` and `@everyone` | uses the cached own name (**replace the hard-coded regex in the mock**) |

### Messages (A)
| Function | Contract | Real implementation |
|---|---|---|
| `loadHistory(id)` | → Message[] oldest first (the whole thread; paging can come later) | select from `messages` + `reactions`, map to shapes |
| `sendMessage(id, payload)` | → Message. `payload = {type, text, replyTo, image?, images?, name?, file?, gif?, link?}`. **Image and file payloads also carry the browser `File` object** (`images[i].file`, `file.blob`) for upload. Must appear instantly (optimistic, local id) and emit `message`; on success swap in the real id; on failure set `failed: true` | upload to `attachments/<conversationId>/<uuid>-<name>`, insert `messages` with `client_id` (so a retry cannot duplicate); offline → keep as `failed` until `retryMessage` or reconnect |
| (photos) | Before upload, jpeg/png/webp photos are shrunk in the browser: long edge max 2000 px, JPEG quality 0.85 (PNG screenshots stay PNG unless over 1.5 MB). GIFs and pictures already small go up untouched; if shrinking fails the original is sent. See `shrink()` in `js/services.supabase.js` |
| `retryMessage(id, messageId)` | → boolean | resend a failed message |
| `discardMessage(id, messageId)` | → boolean | drop a failed message locally |
| `editMessage(id, messageId, text)` | → Message. Own messages only | update `text`, `edited_at` |
| `deleteMessage(id, messageId)` | → Message. Becomes a soft "deleted" placeholder | set `deleted_at`, clear reactions |
| `toggleReaction(id, messageId, emoji)` | → Message | insert/delete `reactions` row |
| `search(query)` | → SearchResult[] across all chats. Chat names, message text, photo names and captions, file names, link titles/domains | RPC `search_all` + local chat-name match |
| `getConnection()` / events `connection` | sync | combine browser online/offline and realtime socket state. `setOnline`/`reconnect` are mock-only drivers; the real adapter reconnects itself and emits `connection` |
| `sendTyping(id)` | called by the composer on every keystroke. Mock: no-op. Real: throttled broadcast on a shared `concorde-typing` channel, auto-stops 3 s after the last key |
| typing | event `typing {conversationId, personId, on}` | received from that broadcast; auto-clears after 5 s if a stop is missed, and when that person's message arrives |

### Calls (workstream B) — built: `js/services.calls.js`
Status: live. Who is in which call comes from `call_sessions`/`call_participants` (realtime + a 45 s sweep that hides anyone with no heartbeat for 100 s); sound and pictures go through LiveKit (room = conversation id, identity = person id). Extra function: `getStream(id, kind)` → MediaStream or null; the call screen uses it to swap placeholder art for the real camera/screen. `call` events may carry `focus: true` (open that chat). Screen share in live mode uses the browser's own picker (the desktop app will supply its own). Token function name comes from `config.livekitTokenFunction`.
Room name = conversation id. Person identity in LiveKit = user id.
| Function | Contract | Real implementation |
|---|---|---|
| `getCall(id)` | sync → CallState or null if no call in that chat | `call_sessions` + `call_participants` (live rows) for lists; LiveKit room state when joined |
| `startCall(id)` / `joinCall(id)` | → CallState | RPC `join_call` then `livekit-token` function, then connect with `livekit-client` |
| `leaveCall()` | → void (leaves the call you are in) | RPC `leave_call`; disconnect room |
| `setMuted(muted)` | → void | mute/unmute mic track; `touch_call` |
| `setCamera(on)` | → void | publish/unpublish camera; `touch_call` |
| `startScreenShare({source, sound})` / `stopScreenShare()` | → void. `source` is `'screen-1'`, `'window-2'`… from the picker | LiveKit screen-share track (Electron supplies the chosen source; see workstream C) |
| speaking | `CallState.speakingId` from LiveKit active speakers; emit `call` on change | |
| `startDirectCall(conversationId, kind)` | → Ring or null. Rings the other person. If their status is `dnd` → Ring with `status:'dnd'`, nothing rings for them | insert `rings` row; callee's client gets it by realtime |
| `getRing()` / `answerRing()` / `endRing()` | sync Ring · answer incoming (joins both) · cancel your own or decline | update `rings.status`; unanswered 30 s → `missed` + system note "Missed … call" |
| `simulateIncoming`, `simulateFriendCamera`, `simulateMention` | **mock only** | — |

### Tell the Tower (A)
`isOwner()` sync boolean (from `profiles.is_owner`) · `listIdeas()` sync Idea[] (live array) · `towerUnread()` sync number ·
`markTowerSeen()` (sets `profiles.tower_seen_at`) · `addIdea({type,text})` · `toggleIdeaPlus(id)` · `addIdeaComment(id,text)` ·
`setIdeaStatus(id,status)` (owner only; the database enforces it too). `simulateIdea` is mock only.

### App updates and window (workstream C)
`getUpdate()` sync → Update · `installUpdate()` → new version string, then the app restarts · event `update`.
Real: `electron-updater` against GitHub Releases. Window controls and tray are Electron features the UI already imitates
(see section 5).

## 4. Events and payloads

| Type | Payload | When |
|---|---|---|
| `message` | `{conversationId, message?, incoming?: true, updated?: true}` | new, edited, deleted, reaction, delivered/failed. `incoming` only for others' new messages (drives sounds, banners) |
| `typing` | `{conversationId, personId, on}` | |
| `call` | CallState | any change to a call in any chat you can see, including the one you are in |
| `conversations` | none | list, unread, mention, pinned, muted, status, profile or call changes |
| `ring` | Ring or null | |
| `tower` | `{idea?, incoming?: true}` | |
| `update` | none | availability or install state changed |
| `connection` | `{online, reconnecting, dropped?, restored?, stillOffline?}` | |

## 5. Screens that assume things (read before building)

- **Sign-in screen:** three steps: email → 6-digit code → (new people only) name and invite code. Errors shown come from your rejection `message`. In the mock, any 6 digits pass, `000000` fails, and an email containing "new" is treated as a new person.
- **Hard-coded in the prototype UI (guard with `config.backend === 'mock'`, nothing else):** `openConversation('hangar')` after sign-in, the Prototype tools pane,
  mock ids in `sim-*` actions. After a real sign-in the first chat should be the most recent conversation, or the welcome screen if there are none.
- **First-run state** (no conversations) is already handled: an empty `listConversations()` shows the welcome screen.
- **Colours** use shared tokens (`css/palettes.css`, generated by `tools/palettes.py`). Do not hard-code colours in new code.

## 6. Workstreams

| | A. Accounts and chat | B. Calls | C. Desktop app |
|---|---|---|---|
| Owns | `js/services.supabase.js`, `supabase/*` | `js/services.calls.js`, `supabase/functions/livekit-token` | `desktop/*` (Electron) |
| Needs | Supabase project (`SETUP.md`) | LiveKit Cloud project; A's `join_call`/`rings` | nothing external at first |
| Done when | Two browser windows signed in as different friends chat, react, edit, delete, send photos, search, go offline and recover. Rules tests in `supabase/tests` pass. | Two windows hear and see each other, mute, camera, screen share, ring/answer/decline/DND all work with the mock removed. | Windows installer runs the UI frameless with working title-bar buttons, tray, tray badge, auto-update, screen-share source picker, notifications; min size 800×560 |

Loading: `js/config.js` selects the backend. In live mode `index.html` loads `services.supabase.js` and `services.calls.js` **after** `services.js`;
each replaces only the functions it owns, so the UI never knows the difference. Keep the mock working: it is how the UI is still demoed offline.

## Housekeeping (v0.15)
- `hideChat(id)` hides a one-to-one chat from your own list; it returns when either person writes again. Resolves true/false.
- `removeFromGroup(conversationId, personId)` owner or group creator only; leaves a "was removed from the group" note.
- `removePerson(personId)` owner only; deletes the account, their one-to-one chats and their messages. Resolves true/false.
