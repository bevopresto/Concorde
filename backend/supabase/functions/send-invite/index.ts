// Emails a friend a one-time invite code. Owner only.
// Runs on Supabase (Edge Functions). Secrets needed: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// (for Gmail: smtp.gmail.com, 465, your address, an "app password", and "Concorde <you@gmail.com>").
// SUPABASE_URL and SUPABASE_ANON_KEY are provided automatically.
//
// The app calls this with { email } (new invite) or { code } (resend an existing one).
// The database decides who is allowed: create_invite() refuses anyone who is not the owner.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const messages: Record<string, string> = {
  not_owner: 'Only the owner can invite people.',
  bad_email: "That email address doesn't look right.",
  already_member: 'That person is already in Concorde.',
  already_invited: 'They already have a pending invite. Use Resend instead.',
  no_such_invite: "That invite can't be resent.",
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'post_only' }, 405);
  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'not_signed_in' }, 401);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: who } = await db.auth.getUser();
  if (!who?.user) return json({ error: 'not_signed_in' }, 401);

  const body = await req.json().catch(() => ({}));
  let invite: { code: string; email: string } | null = null;

  if (body.code) {
    // Resend: only the owner can read invites (security rules), and only pending ones count.
    const { data } = await db.from('invites').select('code,email,uses,max_uses,revoked_at')
      .eq('code', String(body.code).toUpperCase()).maybeSingle();
    if (!data || data.revoked_at || data.uses >= data.max_uses || !data.email) return json({ error: 'no_such_invite', message: messages.no_such_invite }, 400);
    invite = { code: data.code, email: data.email };
  } else {
    const { data, error } = await db.rpc('create_invite', { p_email: body.email });
    if (error) {
      const key = Object.keys(messages).find((k) => error.message.includes(k)) ?? 'error';
      return json({ error: key, message: messages[key] ?? 'Could not create the invite.' }, key === 'not_owner' ? 403 : 400);
    }
    invite = { code: data.code, email: data.email };
  }

  const { data: me } = await db.from('profiles').select('name').eq('id', who.user.id).maybeSingle();
  const from = me?.name ?? 'A friend';
  const mail = nodemailer.createTransport({
    host: Deno.env.get('SMTP_HOST'), port: Number(Deno.env.get('SMTP_PORT') ?? 465),
    secure: Number(Deno.env.get('SMTP_PORT') ?? 465) === 465,
    auth: { user: Deno.env.get('SMTP_USER'), pass: Deno.env.get('SMTP_PASS') },
  });
  try {
    await mail.sendMail({
      from: Deno.env.get('SMTP_FROM'), to: invite.email,
      subject: `${from} invited you to Concorde`,
      text: `${from} invited you to Concorde, a small private place to chat and call.\n\n${Deno.env.get('APP_URL') ? 'Get the app: ' + Deno.env.get('APP_URL') + '\n\n' : ''}Open Concorde and sign in with this email address (${invite.email}). Concorde will email you a 6-digit sign-in code; type that in, choose your name, and you're in. You don't need to type any other code.\n\nIf the app ever does ask for an invite code, use this one: ${invite.code}\nIt works once and expires in 14 days.`,
    });
  } catch (_e) {
    return json({ error: 'email_failed', message: "The invite was made, but the email couldn't be sent. Try Resend in a minute." }, 502);
  }
  return json({ ok: true, email: invite.email });
});
