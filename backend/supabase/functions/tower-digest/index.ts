// Daily Tower digest: emails the owner what's new in "Tell the Tower" and what's still open.
// Secrets needed: TOWER_DIGEST_KEY (any long random phrase you invent), plus the same SMTP_* secrets as send-invite.
// Optional: DIGEST_TO (where to send; defaults to SMTP_USER). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are automatic.
// Turn "Verify JWT" OFF for this function: a daily timer calls it with the TOWER_DIGEST_KEY header instead of a login.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6';

Deno.serve(async (req) => {
  const key = Deno.env.get('TOWER_DIGEST_KEY');
  if (!key || req.headers.get('x-digest-key') !== key) return new Response('no', { status: 401 });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: ideas, error } = await db.from('ideas')
    .select('id,type,text,status,created_at,images,author:profiles!author_id(name),plus:idea_plus(user_id),cmts:idea_comments(id)')
    .order('created_at', { ascending: false });
  if (error) return new Response('db: ' + error.message, { status: 500 });

  const since = Date.now() - 24 * 3600 * 1000;
  const line = (i: any) => `- [${i.type === 'bug' ? 'BUG' : 'Idea'}] ${i.text}\n    from ${i.author?.name ?? 'someone'} · +${i.plus?.length ?? 0} · ${i.cmts?.length ?? 0} comments${i.images?.length ? ` · ${i.images.length} screenshot(s)` : ''}`;
  const fresh = (ideas ?? []).filter((i: any) => new Date(i.created_at).getTime() >= since);
  const open = (ideas ?? []).filter((i: any) => (i.status === 'new' || i.status === 'planned') && new Date(i.created_at).getTime() < since);

  if (!fresh.length && !Deno.env.get('DIGEST_ALWAYS')) return new Response('nothing new');

  const text = [
    `New in the Tower (last 24 hours): ${fresh.length}`,
    fresh.length ? fresh.map(line).join('\n') : '- nothing new',
    '',
    `Still open (new or planned): ${open.length}`,
    open.length ? open.slice(0, 25).map((i: any) => `${line(i)}\n    status: ${i.status}`).join('\n') : '- nothing open',
  ].join('\n');

  const port = Number(Deno.env.get('SMTP_PORT') ?? 465);
  const mail = nodemailer.createTransport({ host: Deno.env.get('SMTP_HOST'), port, secure: port === 465, auth: { user: Deno.env.get('SMTP_USER'), pass: Deno.env.get('SMTP_PASS') } });
  await mail.sendMail({ from: Deno.env.get('SMTP_FROM'), to: Deno.env.get('DIGEST_TO') ?? Deno.env.get('SMTP_USER'), subject: `Concorde Tower: ${fresh.length} new`, text });
  return new Response('sent');
});
