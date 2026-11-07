// Hands a signed-in friend a short-lived pass into a call room.
// Runs on Supabase (Edge Functions). Secrets needed: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET.
// SUPABASE_URL and SUPABASE_ANON_KEY are provided automatically.
//
// The app calls join_call(conversation) in the database first, then calls this with { conversationId }.
// We only issue a pass if the database says this person is in that chat AND is in its live call.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AccessToken } from 'npm:livekit-server-sdk@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'post_only' }, 405);

  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'not_signed_in' }, 401);

  // Talk to the database AS the caller, so the security rules apply to them.
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: who, error: whoErr } = await db.auth.getUser();
  if (whoErr || !who?.user) return json({ error: 'not_signed_in' }, 401);

  let conversationId = '';
  try { conversationId = String((await req.json()).conversationId || ''); } catch { /* fall through */ }
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return json({ error: 'bad_request' }, 400);

  // Must be a member (row security hides other people's chats) and be in the live call right now.
  const { data: session } = await db
    .from('call_sessions').select('id').eq('conversation_id', conversationId).is('ended_at', null).maybeSingle();
  if (!session) return json({ error: 'no_live_call' }, 403);
  const { data: me } = await db
    .from('call_participants').select('user_id').eq('session_id', session.id).eq('user_id', who.user.id).is('left_at', null).maybeSingle();
  if (!me) return json({ error: 'not_in_call' }, 403);

  const { data: profile } = await db.from('profiles').select('name').eq('id', who.user.id).single();

  const at = new AccessToken(Deno.env.get('LIVEKIT_API_KEY')!, Deno.env.get('LIVEKIT_API_SECRET')!, {
    identity: who.user.id,            // the app maps this id back to a friend
    name: profile?.name ?? 'Friend',
    ttl: '6h',
  });
  at.addGrant({ room: conversationId, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });

  return json({ token: await at.toJwt(), url: Deno.env.get('LIVEKIT_URL') });
});
