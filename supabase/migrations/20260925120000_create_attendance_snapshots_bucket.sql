-- Storage bucket for attendance snapshots.
-- The app (src/routes/index.tsx) uploads JPEGs here and reads them back via
-- createSignedUrl, so the bucket stays private and access is time-limited.
insert into storage.buckets (id, name, public)
select 'attendance-snapshots', 'attendance-snapshots', false
where not exists (
  select 1 from storage.buckets where id = 'attendance-snapshots'
);

-- The bucket is private, so the read policy only governs SELECT on objects
-- (required for createSignedUrls); public URLs are not served.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'public read snapshots'
  ) then
    create policy "public read snapshots"
      on storage.objects for select
      using (bucket_id = 'attendance-snapshots');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'public upload snapshots'
  ) then
    create policy "public upload snapshots"
      on storage.objects for insert
      with check (bucket_id = 'attendance-snapshots');
  end if;
end $$;
