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
4. Auth settings (Supabase → Authentication):
   - **Sign In / Providers**: turn **off** "Allow new users to sign up" and keep "Confirm email" on. The app creates team members' accounts itself, so public sign-up stays closed (otherwise anyone with the publishable key could register a team email).
   - **URL Configuration**: set Site URL to `http://localhost:3000` (later the Vercel URL) and add `http://localhost:3000/auth/confirm` to Redirect URLs.
   - **Email Templates → Magic Link**: include the code and a cross-browser link, so sign-in works from a home-screen app:
     ```html
     <h2>Sign in to crm-map</h2>
     <p>Your code: <strong>{{ .Token }}</strong></p>
     <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Or tap to sign in</a></p>
     ```
5. `npm install && npm run dev`, then open http://localhost:3000.

Only emails in `team_members` can request a sign-in code, and row-level security limits every table to those emails.

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

## Email sign-in limits

Supabase's built-in email sender allows only a couple of auth emails per hour and only delivers to members of your Supabase organization. Before more people use the app, set up custom SMTP (Authentication → Emails → SMTP Settings; a Gmail app password works) and raise the email rate limit (Authentication → Rate Limits).
