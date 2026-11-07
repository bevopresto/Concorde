# Setting up the real services (about 20 minutes, all in your web browser)

You need two free accounts. You do not need to install anything for these steps.

## 1. Supabase (accounts, chat, photos and files)
1. Go to supabase.com, sign up, click **New project**. Name it `concorde`. Pick the region closest to Sydney. Choose and save a database password.
2. When it finishes (a minute or two): **SQL Editor → New query**, paste the whole of `backend/supabase/schema.sql`, click **Run**. It should end with "Success".
3. **Project Settings → API:** copy the **Project URL** and the **anon public** key. (The anon key is meant to be public; the rules in step 2 protect the data.)
4. **Authentication:** see "How people sign in" below and switch on the option we choose.

## 2. LiveKit Cloud (voice, video, screen share)
1. Go to livekit.io, sign up, click **Create project**. Name it `concorde`.
2. **Settings → Keys:** note the **WebSocket URL** (starts `wss://`), the **API key** and the **API secret**.

## 3. Hand the keys to the build (not in chat)
Give them to Claude in the session as: Supabase URL, Supabase anon key, LiveKit URL. The LiveKit **API key and secret are private**:
they go only into Supabase (Project Settings → Edge Functions → Secrets, named `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`). Do not paste the secret anywhere else.

## How people sign in (decided: email code)
Friends enter an email and get a 6-digit code. Existing accounts go straight in; new people then choose a name and enter an invite code.
In Supabase: **Authentication → Providers → Email**: keep it on, turn **off** "Confirm email" if offered, and make sure it sends a code.
**Authentication → Email Templates:** edit BOTH **Magic Link** and **Confirm signup** so the body includes the code, for example `Your Concorde code is {{ .Token }}`.
(New people get the Confirm signup email, returning people get the Magic Link email. If either still shows only a link, the code won't arrive.)
Heads up: Supabase's built-in email sender has a small hourly limit. That is fine for a few friends signing in now and then, but if sign-in emails
ever stop arriving, add a free outgoing-mail service (Authentication → SMTP Settings; Resend has a free tier).

## First run
The first person to join becomes the owner (that's you) and needs no code. Then create invite codes in the Supabase table editor
(table `invites`: add a row, code `CNC-2026`, max_uses 10).

**Inviting from inside the app (owner only).** Deploy the `send-invite` function and give it an email account to send from.
For Gmail: turn on 2-step verification, make an "app password" (Google Account → Security → App passwords), then add these Edge Function secrets:
`SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=you@gmail.com`, `SMTP_PASS=<app password>`, `SMTP_FROM=Concorde <you@gmail.com>`.
The same account can also be used for Supabase Auth → SMTP settings, which lifts the small hourly limit on sign-in code emails.


## Updating the database later
When a new version adds database changes, paste the whole of `backend/supabase/schema.sql` into the SQL Editor again and Run. It is safe to repeat; Supabase will warn about "destructive operations" (the drop-and-recreate rules), which is expected.

## Calls (v0.13)
1. Supabase > SQL Editor: paste the whole of `backend/supabase/schema.sql` and run it again (safe to repeat). It adds the call heartbeat and ringing.
2. Edge Functions > Secrets: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (from your LiveKit project; paste them only into Supabase).
3. Edge Functions > deploy a new function with the contents of `functions/livekit-token/index.ts`. Supabase picks the function's name (yours is `smooth-function`).
   Put that name in `js/config.js` as `livekitTokenFunction`. Turn "Verify JWT with legacy secret" off for it (the function checks the person itself).
