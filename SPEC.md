# crm-map — spec

A field CRM for Joshua and Colton's LA trip: every contact on a map, "who's near this meeting?", and an optimized day route that hands off to Google Maps. Think LDS area book / pest-route app, for founders, trade-finance people and supply-chain operators.

Target: usable on both phones within 1–2 days. Mostly phone, sometimes laptop for morning planning.

## Decisions

| Area | Decision |
|---|---|
| App | Next.js (App Router, TypeScript, Tailwind) on Vercel, installable PWA, mobile-first |
| Data | Supabase Postgres + PostGIS. **Supabase is the source of truth** for contacts going forward |
| Auth | Supabase email magic link; only Joshua's and Colton's emails allowed (RLS); both see and edit everything |
| Map | Mapbox GL (react-map-gl), clustered pins |
| Geocoding | Mapbox Geocoding, run automatically on every insert; low-confidence results flagged so you can fix them by dragging a pin |
| Routing | Mapbox Optimization API to order stops; navigation via Google Maps URL links (no key, ≤9 waypoints per link, longer days split into legs) |
| AI ingest | In-app "paste anything" box → Claude API (`claude-sonnet-5-5`, accepts text and images) extracts contacts → review cards → confirm → insert |
| Search-brain | One-time import of `~/Work/search-brain/people` and `companies` (6 + 6 today). No ongoing sync for now |

## Data model

- **companies**: name, website, industry, kind (prospect / partner / investor / inspiration), address, location (geography point), brain_slug
- **contacts**: name, company_id, role, email, phone, linkedin, **category** (founder / financier / supply-chain / other), relationship, **stage** (search-brain pipeline: identified → contacted → replied → call-booked → talked → asked → committed → paid / lost / nurture), **priority** (must-see / want-to-see / if-nearby), owner (joshua / colton), source, notes, address, location, geocode_confidence, location_from_company, brain_slug
  - A contact with no address of their own uses their company's location
- **visits**: contact_id, status (scheduled / done / skipped), starts_at, ends_at (for scheduled meetings), place address + location (defaults to the contact's), who (joshua / colton / both), type (meeting / drop-in / call), outcome, notes, next_step. A scheduled meeting becomes a "done" visit once it's logged.
- **places**: saved start points (hotel, Airbnb), with one marked as default
- **day_plans**: date, start place, ordered stops (contact or meeting), generated Google Maps links

## Screens

1. **Map**: pins colored by category and sized by priority, with today's meetings highlighted. Filter by category, stage, priority, owner and "not yet visited". Tap a pin to open the contact sheet.
2. **Contact sheet**: details plus one-tap call, email, LinkedIn and navigate. Visit history, a "Log visit" button, and stage/priority edits.
3. **Nearby**: pick a meeting or "my location" and a radius. Shows contacts sorted by distance, with priority applied, and lets you add them to today's plan.
4. **Plan day**: pick a date and a start point (default hotel, or current location). Scheduled meetings are fixed anchors. Picked contacts get optimized into the gaps between anchors. The output is an ordered list with ETAs, a warning when a meeting would be missed, and "Open in Google Maps" buttons for each leg.
5. **Add**: three tabs.
   - *Paste / photo* (Claude): returns review cards with extracted fields, a mini-map location and a duplicate warning. Confirm one at a time or all at once.
   - *CSV*: upload, map columns, preview, import.
   - *Quick add*: name, company, category, and an address or "drop pin where I am".
6. **List**: a sortable table of all contacts (the laptop view), with inline editing.

## Ingest pipeline (one path for everything)

Chat, CSV, quick-add, the brain import and agents all call the same server function:
normalize → dedupe (email, LinkedIn URL, then name + company) → geocode (contact address, falling back to company address) → insert → flag low-confidence geocodes and possible duplicates for review.

Agents and Claude Code call it through an authenticated API endpoint (`POST /api/ingest`, bearer token). A thin MCP wrapper can come later. Agents don't get raw database access.

## Build order

1. Scaffold Next.js, Supabase schema + RLS, magic-link auth, deploy to Vercel
2. Ingest function + quick-add + search-brain import
3. Map screen + contact sheet + log visit
4. Meetings + Nearby
5. Plan day (optimization + Google Maps links)
6. Paste/photo Claude ingest + CSV upload
7. PWA polish (home-screen icon, works over a weak connection)

## What you need to set up (about 15 minutes)

- Supabase project (free tier): project URL + anon key + service role key
- Mapbox account: public access token
- Anthropic API key (for the paste/photo ingest)
- Vercel account linked to a GitHub repo for this project
- Colton's email, for the allow-list
- Hotel address(es) and trip dates (these can be entered in the app)

## Later

- Two-way sync with search-brain md files, so daily-run agents and the app share data
- Google Calendar sync for meetings
- Google Routes API for traffic-aware ordering, if Mapbox ETAs prove off in LA traffic
- MCP server over `/api/ingest`
