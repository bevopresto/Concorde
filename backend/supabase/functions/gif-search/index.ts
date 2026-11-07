// GIF search for the picker. Keeps the GIPHY key on the server, away from the app.
// Secret needed: GIPHY_API_KEY. SUPABASE_URL and SUPABASE_ANON_KEY are provided automatically.
//
// The app sends { q, offset } (q empty = what's trending) and gets back a short list of GIFs.
// Answers are remembered for a few minutes so the free GIPHY allowance (100 calls an hour) goes a long way.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const cache = new Map<string, { at: number; body: unknown }>();
const KEEP_MS = 5 * 60 * 1000;
const PER_PAGE = 24;

// deno-lint-ignore no-explicit-any
function pick(g: any) {
  const im = g.images || {};
  const full = im.fixed_height || im.downsized || im.original;
  const small = im.fixed_width_small || im.fixed_width || full;
  if (!full?.url) return null;
  return {
    id: String(g.id),
    title: String(g.alt_text || g.title || 'GIF').trim().slice(0, 80) || 'GIF',
    url: full.url as string,
    preview: (small?.url || full.url) as string,
    w: Number(full.width) || 200,
    h: Number(full.height) || 200,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'post_only' }, 405);

  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'not_signed_in' }, 401);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: who, error: whoErr } = await db.auth.getUser();
  if (whoErr || !who?.user) return json({ error: 'not_signed_in' }, 401);

  const key = Deno.env.get('GIPHY_API_KEY');
  if (!key) return json({ error: 'not_set_up' }, 503);

  let body: { q?: string; offset?: number } = {};
  try { body = await req.json(); } catch { /* empty is fine */ }
  const q = String(body.q || '').trim().slice(0, 60);
  const offset = Math.max(0, Math.min(400, Math.floor(Number(body.offset) || 0)));

  const ck = q.toLowerCase() + '|' + offset;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < KEEP_MS) return json(hit.body);

  const url = new URL('https://api.giphy.com/v1/gifs/' + (q ? 'search' : 'trending'));
  url.searchParams.set('api_key', key);
  url.searchParams.set('limit', String(PER_PAGE));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('rating', 'pg-13');
  if (q) url.searchParams.set('q', q);

  const r = await fetch(url);
  if (r.status === 429) return json({ error: 'busy' }, 429);
  if (!r.ok) return json({ error: 'upstream' }, 502);
  const data = await r.json();
  const items = (data.data || []).map(pick).filter(Boolean);
  const total = Number(data.pagination?.total_count) || 0;
  const out = { items, next: offset + PER_PAGE < Math.min(total, 500) ? offset + PER_PAGE : null };
  cache.set(ck, { at: Date.now(), body: out });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return json(out);
});
