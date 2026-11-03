# crm-map

Contacts on a map, "who's near this meeting?", and optimized day routes for the LA trip. See [SPEC.md](SPEC.md).

## Setup

1. `cp .env.example .env.local` and fill in the Supabase values (Project Settings → API Keys).
2. Apply the schema to the hosted project:
   ```bash
   supabase link --project-ref <project-ref>
   supabase db push
   ```
3. Add Colton to the allow-list (Supabase SQL editor):
   ```sql
   insert into team_members (email, name) values ('<colton email>', 'colton');
   ```
4. Auth settings (Supabase → Authentication → Sign In / Providers): turn **off** "Allow new users to sign up" and keep "Confirm email" on. The app creates team members' accounts itself, so public sign-up stays closed (otherwise anyone with the publishable key could register a team email).
5. Set `TEAM_PASSCODE` in `.env.local` and in Vercel's environment variables. Sign-in is a team email plus this shared passcode; no email is sent, so there's no SMTP or email template to set up.
6. `npm install && npm run dev`, then open http://localhost:3000.

## Sign-in

Enter a `team_members` email and `TEAM_PASSCODE`. The server checks both, mints a one-time Supabase sign-in token itself (nothing is emailed) and redeems it, so you get a normal Supabase session: row-level security still limits every table to `team_members`, and the session lasts until you sign out. It's meant for a small internal team: anyone with a team email *and* the passcode can get in, so use a passcode longer than a PIN and change it (in both places) if it leaks. Guesses are limited per client IP (10 per 15 minutes) and overall (100 per 15 minutes), never per email, since the passcode is the secret. Each attempt is recorded in `login_attempts` before the passcode is checked, so parallel requests can't overshoot; the IP comes from Vercel's `x-vercel-forwarded-for`, which clients can't forge. Attempts over an IP's own limit don't count toward the overall cap, and a success only marks its own attempt, so pausing sign-in for everyone takes 10+ separate IPs (existing sessions keep working). Rows older than a day are pruned. Sign-in also refuses a `TEAM_PASSCODE` shorter than 12 characters.

## Adding contacts

Every source goes through `ingestContact` in [src/lib/ingest.ts](src/lib/ingest.ts): normalize → dedupe (search-brain slug, email, LinkedIn URL, then name + company) → geocode with Mapbox → insert. Contacts with no usable location (none, or only a state/country) are saved with `needs_review` so you can drop a pin later. A contact without its own address shows at its company's location.

- **Paste or photo** (`/add`, first tab): paste LinkedIn profiles, email signatures, scraped lists or notes, or add photos of business cards or screenshots. Claude (`claude-opus-5-5`, structured output, server-side refusal fallback on) extracts contacts into review cards that show the duplicate match and where each one will land on the map. Nothing saves until you confirm. Needs `ANTHROPIC_API_KEY`.
- **CSV** (`/add`, second tab): upload any CSV with a header row, match columns (street/city/zip columns combine into one address), preview, then import. Duplicates are skipped or filled in, your choice.
- **One contact** (`/add`, third tab): a form. "Use my location" pins the contact where you're standing.
- **Agents / Claude Code**: `POST /api/ingest` with `Authorization: Bearer $INGEST_API_TOKEN`:
  ```bash
  curl -X POST http://localhost:3000/api/ingest \
    -H "Authorization: Bearer $INGEST_API_TOKEN" -H "content-type: application/json" \
    -d '{"contacts":[{"name":"Jane Doe","company":"Acme Imports","address":"Vernon, CA","category":"supply-chain"}],"on_duplicate":"skip"}'
  ```
  `on_duplicate`: `skip` (default, report and stop), `merge` (fill the existing record's empty fields), `force` (add even if the name matches).
- **Search-brain import**: `npm run import:brain` (reads `~/Work/search-brain`; safe to re-run).
- **Geocode backfill**: `npm run geocode:missing` geocodes anything saved with an address but no pin.

## On the phone

- **Install:** open the site in Safari → Share → Add to Home Screen, then open it from the icon and sign in there once with your email and the passcode (the home-screen app keeps its own login). Icons come from `scripts/make-icons.py`.
- **Weak signal:** `public/sw.js` (registered in production only) keeps app code cached and saves each page after it loads. If the network takes over 4 seconds, the last saved copy shows while the fresh one loads; with no signal at all, saved pages still open and the map shows tiles you've already looked at. A pill under the top bar says when you're offline or looking at older data. Saved pages are deleted whenever the login page loads or a page load gets sent to login, so they never outlive a session.
- **Logging visits offline:** visits saved with no connection wait on the phone and sync automatically when the connection returns (retried every 30 s). Each visit carries an id made on the phone, so a retry can't create a duplicate, and records who logged it, so it only syncs from that person's session. Other edits need a connection.
