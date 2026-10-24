-- crm-map initial schema: companies, contacts, visits, places, day plans.
-- Access is limited to emails in team_members (Joshua and Colton); both see and edit everything.

create extension if not exists postgis with schema extensions;

-- ---------- enums ----------
create type contact_category as enum ('founder', 'financier', 'supply-chain', 'other');
create type contact_priority as enum ('must-see', 'want-to-see', 'if-nearby');
-- Same pipeline as the search-brain CRM (crm/README.md).
create type contact_stage as enum (
  'identified', 'contacted', 'replied', 'call-booked', 'talked',
  'asked', 'committed', 'paid', 'lost', 'nurture'
);
create type company_kind as enum ('prospect', 'partner', 'investor', 'inspiration');
create type team_owner as enum ('joshua', 'colton');
create type visit_status as enum ('scheduled', 'done', 'skipped');
create type visit_type as enum ('meeting', 'drop-in', 'call');
create type visit_who as enum ('joshua', 'colton', 'both');

-- ---------- access ----------
create table team_members (
  email text primary key,
  name team_owner not null
);

insert into team_members (email, name) values
  ('jsphelps12@gmail.com', 'joshua');
-- TODO: add Colton once we have his email:
-- insert into team_members (email, name) values ('<colton email>', 'colton');

create function is_team_member() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.team_members
    where lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;

-- ---------- helpers ----------
create function set_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- lat/lng are the editable columns; location is derived for PostGIS distance queries.
-- geocode_confidence: 'exact' | 'street' | 'city' | 'manual' | 'low' (low = needs a human to fix the pin)

-- ---------- companies ----------
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  website text,
  industry text,
  kind company_kind,
  address text,
  lat double precision,
  lng double precision,
  location extensions.geography(point, 4326) generated always as (
    case when lat is null or lng is null then null
    else extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography end
  ) stored,
  geocode_confidence text,
  notes text,
  brain_slug text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- contacts ----------
create table contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company_id uuid references companies (id) on delete set null,
  role text,
  email text,
  phone text,
  linkedin text,
  category contact_category not null default 'other',
  relationship text,
  stage contact_stage,
  priority contact_priority not null default 'want-to-see',
  owner team_owner,
  source text,
  notes text,
  address text,
  lat double precision,
  lng double precision,
  location extensions.geography(point, 4326) generated always as (
    case when lat is null or lng is null then null
    else extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography end
  ) stored,
  geocode_confidence text,
  needs_review boolean not null default false,
  brain_slug text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index contacts_email_key on contacts (lower(email)) where email is not null;
create unique index contacts_linkedin_key on contacts (lower(linkedin)) where linkedin is not null;
create index contacts_company_idx on contacts (company_id);
create index contacts_location_idx on contacts using gist (location);
create index companies_location_idx on companies using gist (location);

-- ---------- visits (scheduled meetings + logged stops) ----------
create table visits (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts (id) on delete cascade,
  status visit_status not null default 'scheduled',
  type visit_type not null default 'meeting',
  starts_at timestamptz,
  ends_at timestamptz,
  -- place defaults to the contact's location when null
  address text,
  lat double precision,
  lng double precision,
  who visit_who,
  outcome text,
  notes text,
  next_step text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create index visits_contact_idx on visits (contact_id);
create index visits_starts_at_idx on visits (starts_at);

-- ---------- places (hotel / start points) ----------
create table places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  lat double precision not null,
  lng double precision not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index places_one_default on places (is_default) where is_default;

-- ---------- day plans ----------
create table day_plans (
  id uuid primary key default gen_random_uuid(),
  plan_date date not null unique,
  start_place_id uuid references places (id) on delete set null,
  -- ordered: [{ "kind": "contact" | "visit", "id": uuid, "eta": iso8601 }]
  stops jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger companies_updated_at before update on companies for each row execute function set_updated_at();
create trigger contacts_updated_at before update on contacts for each row execute function set_updated_at();
create trigger visits_updated_at before update on visits for each row execute function set_updated_at();
create trigger day_plans_updated_at before update on day_plans for each row execute function set_updated_at();

-- ---------- effective location (contact's own, else company's) ----------
create view contacts_located with (security_invoker = true) as
select
  c.*,
  co.name as company_name,
  coalesce(c.lat, co.lat) as map_lat,
  coalesce(c.lng, co.lng) as map_lng,
  coalesce(c.location, co.location) as map_location,
  (c.lat is null and co.lat is not null) as location_from_company
from contacts c
left join companies co on co.id = c.company_id;

-- Contacts within radius_m meters of a point, nearest first.
create function nearby_contacts(lat double precision, lng double precision, radius_m double precision default 8000)
returns table (id uuid, name text, company_name text, category contact_category, priority contact_priority,
               stage contact_stage, map_lat double precision, map_lng double precision, distance_m double precision)
language sql stable set search_path = ''
as $$
  select cl.id, cl.name, cl.company_name, cl.category, cl.priority, cl.stage, cl.map_lat, cl.map_lng,
         extensions.st_distance(cl.map_location,
           extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography) as distance_m
  from public.contacts_located cl
  where cl.map_location is not null
    and extensions.st_dwithin(cl.map_location,
          extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography, radius_m)
  order by distance_m;
$$;

-- ---------- row level security ----------
alter table team_members enable row level security;
alter table companies enable row level security;
alter table contacts enable row level security;
alter table visits enable row level security;
alter table places enable row level security;
alter table day_plans enable row level security;

create policy "team reads team" on team_members for select to authenticated using (is_team_member());

create policy "team all" on companies for all to authenticated using (is_team_member()) with check (is_team_member());
create policy "team all" on contacts  for all to authenticated using (is_team_member()) with check (is_team_member());
create policy "team all" on visits    for all to authenticated using (is_team_member()) with check (is_team_member());
create policy "team all" on places    for all to authenticated using (is_team_member()) with check (is_team_member());
create policy "team all" on day_plans for all to authenticated using (is_team_member()) with check (is_team_member());

revoke execute on function nearby_contacts from anon, public;
grant execute on function nearby_contacts to authenticated;
