-- Day plans keep the picked contacts in `stops` (array of contact ids), the planner
-- settings (start point, day hours, time per stop), and the last optimized route,
-- so Joshua and Colton see the same plan.
alter table day_plans
  add column settings jsonb not null default '{}'::jsonb,
  add column result jsonb;

comment on column day_plans.stops is 'Picked contact ids, in the order they were added.';
comment on column day_plans.result is 'Last optimized route: ordered stops with ETAs, warnings, route geometry.';
