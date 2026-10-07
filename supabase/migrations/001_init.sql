create table profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 20),
  created_at timestamptz not null default now()
);

create table recipes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  summary text,
  cook_time_min int,
  difficulty text,
  ingredients jsonb not null,
  steps jsonb not null,
  created_at timestamptz not null default now()
);
create index on recipes (profile_id, created_at desc);

alter table profiles enable row level security;
alter table recipes  enable row level security;

create policy "anon read profiles"   on profiles for select to anon using (true);
create policy "anon create profiles" on profiles for insert to anon with check (true);

create policy "anon read recipes"    on recipes  for select to anon using (true);
create policy "anon create recipes"  on recipes  for insert to anon with check (true);
create policy "anon delete recipes"  on recipes  for delete to anon using (true);

grant select, insert on public.profiles to anon;
grant select, insert, delete on public.recipes to anon;
