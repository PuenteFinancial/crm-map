-- A contact can be on several lists (the LA Brands sheet, the ICP Brands tab, ...), so the
-- map can show one list on its own even when lists overlap.
alter table contacts add column lists text[] not null default '{}';

-- Backfill from the import source, using the same naming as listName() in src/lib/contacts.ts:
-- "sheet: <name> (<detail>)" / "csv: <file>" -> <name>.
update contacts set lists = array[
  case
    when source ~* '^(sheet|csv):' then
      regexp_replace(regexp_replace(regexp_replace(source, '^(sheet|csv):\s*', '', 'i'), '\s*\([^)]*\)$', ''), '\.csv$', '', 'i')
    when source like 'search-brain%' then 'Search brain'
    when source like 'claude%' then 'Paste / photo'
    when source = 'quick-add' then 'Quick add'
    else 'Other'
  end
];

create index contacts_lists_idx on contacts using gin (lists);

-- contacts_located selects c.*, which Postgres expands when the view is created, so it has to be
-- recreated to include the new column (and nearby_contacts depends on it).
drop function nearby_contacts(double precision, double precision, double precision);
drop view contacts_located;

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

revoke execute on function nearby_contacts from anon, public;
grant execute on function nearby_contacts to authenticated;
