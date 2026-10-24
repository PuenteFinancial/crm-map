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
   - **URL Configuration**: set Site URL to `http://localhost:3000` (later the Vercel URL) and add `http://localhost:3000/auth/confirm` to Redirect URLs.
   - **Email Templates → Magic Link**: include the code and a cross-browser link, so sign-in works from a home-screen app:
     ```html
     <h2>Sign in to crm-map</h2>
     <p>Your code: <strong>{{ .Token }}</strong></p>
     <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Or tap to sign in</a></p>
     ```
5. `npm install && npm run dev`, then open http://localhost:3000.

Only emails in `team_members` can request a sign-in code, and row-level security limits every table to those emails.
