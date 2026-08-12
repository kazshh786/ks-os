-- Provision the private Supabase Storage bucket used by governed Fact Finding,
-- Agency Brand & Assets, and Search Research uploads.
--
-- Keep this idempotent because existing environments may have had the bucket
-- created manually during incident recovery.

do $$ begin
  if to_regclass('storage.buckets') is not null then
    execute $storage$
      insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      values (
        'private-fact-finding',
        'private-fact-finding',
        false,
        20971520,
        array[
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/avif',
          'application/pdf',
          'text/plain',
          'text/csv',
          'application/json',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ]
      )
      on conflict(id) do update set
        public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types
    $storage$;
  end if;
end $$;
