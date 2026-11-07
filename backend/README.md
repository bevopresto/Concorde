# Backend folder
- `SERVICES.md` — the contract every real service must keep (start here)
- `SETUP.md` — the steps Bev does once, in the browser
- `supabase/schema.sql` — database, security rules, functions, storage
- `supabase/functions/livekit-token` — gives friends a pass into a call room
- `supabase/tests` — security-rule checks. To run: any Postgres, run `supabase-stub.sql` (pretends to be Supabase) then `schema.sql` then `rules-test.sql`. Last line should be `ALL-CHECKS-RAN`.
