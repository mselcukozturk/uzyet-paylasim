create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.question_banks (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  question_count integer not null check (question_count >= 0),
  is_active boolean not null default false,
  imported_at timestamptz not null default now()
);

create unique index one_active_question_bank on public.question_banks (is_active) where is_active;

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.question_banks(id) on delete restrict,
  guid text not null,
  topic text not null,
  prompt text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 4),
  correct_index smallint not null check (correct_index between 0 and 3),
  explanation text not null default '',
  source text not null default '',
  verified boolean not null default false,
  unique (bank_id, guid)
);

create index questions_bank_topic_idx on public.questions (bank_id, topic);

create table public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bank_id uuid not null references public.question_banks(id) on delete restrict,
  mode text not null check (mode in ('rastgele', 'azgorulen', 'yanlislar')),
  status text not null default 'active' check (status in ('active', 'paused', 'finished', 'cancelled')),
  exam_code text not null unique,
  started_at timestamptz not null default now(),
  last_resumed_at timestamptz default now(),
  elapsed_seconds integer not null default 0 check (elapsed_seconds >= 0),
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  correct_count integer,
  wrong_count integer,
  blank_count integer,
  score_percent integer check (score_percent between 0 and 100),
  stats_applied boolean not null default false
);

create unique index one_open_exam_per_user on public.exam_attempts (user_id)
  where status in ('active', 'paused');
create index exam_attempts_user_updated_idx on public.exam_attempts (user_id, updated_at desc);

create table public.exam_attempt_questions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  question_guid text not null,
  position smallint not null check (position between 1 and 50),
  topic text not null,
  prompt text not null,
  options jsonb not null,
  correct_index smallint not null check (correct_index between 0 and 3),
  explanation text not null default '',
  unique (attempt_id, position),
  unique (attempt_id, question_id)
);

create table public.exam_answers (
  attempt_question_id uuid primary key references public.exam_attempt_questions(id) on delete cascade,
  selected_index smallint not null check (selected_index between 0 and 3),
  answered_at timestamptz not null default now()
);

create table public.question_stats (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_guid text not null,
  shown_count integer not null default 0,
  correct_count integer not null default 0,
  wrong_count integer not null default 0,
  last_result boolean,
  last_seen_at timestamptz,
  primary key (user_id, question_guid)
);

create table public.question_flags (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_guid text not null,
  note text not null default '',
  is_reported boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, question_guid)
);

alter table public.profiles enable row level security;
alter table public.question_banks enable row level security;
alter table public.questions enable row level security;
alter table public.exam_attempts enable row level security;
alter table public.exam_attempt_questions enable row level security;
alter table public.exam_answers enable row level security;
alter table public.question_stats enable row level security;
alter table public.question_flags enable row level security;

revoke all on public.question_banks, public.questions, public.exam_attempts,
  public.exam_attempt_questions, public.exam_answers, public.question_stats,
  public.question_flags from anon, authenticated;

grant select, update on public.profiles to authenticated;
create policy "profile_read_own" on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy "profile_update_own" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.apply_finished_exam_stats(
  p_attempt_id uuid,
  p_user_id uuid,
  p_results jsonb
)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  item jsonb;
  finished_at_value timestamptz;
begin
  select finished_at into finished_at_value
  from public.exam_attempts
  where id = p_attempt_id and user_id = p_user_id and status = 'finished' and stats_applied = false
  for update;

  if not found then return; end if;

  for item in select value from jsonb_array_elements(p_results)
  loop
    insert into public.question_stats (
      user_id, question_guid, shown_count, correct_count, wrong_count, last_result, last_seen_at
    ) values (
      p_user_id,
      item ->> 'guid',
      1,
      case when (item ->> 'isCorrect')::boolean then 1 else 0 end,
      case when (item ->> 'isCorrect')::boolean = false then 1 else 0 end,
      case when item ->> 'isCorrect' is null then null else (item ->> 'isCorrect')::boolean end,
      finished_at_value
    )
    on conflict (user_id, question_guid) do update set
      shown_count = public.question_stats.shown_count + 1,
      correct_count = public.question_stats.correct_count + excluded.correct_count,
      wrong_count = public.question_stats.wrong_count + excluded.wrong_count,
      last_result = excluded.last_result,
      last_seen_at = excluded.last_seen_at;
  end loop;

  update public.exam_attempts set stats_applied = true where id = p_attempt_id;
end;
$$;

revoke all on function public.apply_finished_exam_stats(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_finished_exam_stats(uuid, uuid, jsonb) to service_role;
