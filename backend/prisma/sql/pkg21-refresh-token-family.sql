BEGIN;

DO $$
BEGIN
  IF to_regclass('public.refresh_tokens') IS NOT NULL THEN
    ALTER TABLE public.refresh_tokens
      ADD COLUMN IF NOT EXISTS session_family_id TEXT;

    -- Existing refresh tokens predate family metadata. Group legacy rows by
    -- user to retain the old replay policy, which revoked all of that user's
    -- tokens. New sessions receive independent UUID families in application code.
    UPDATE public.refresh_tokens
    SET session_family_id = user_id
    WHERE session_family_id IS NULL OR session_family_id = id;

    ALTER TABLE public.refresh_tokens
      ALTER COLUMN session_family_id SET NOT NULL;
  END IF;
END
$$;

COMMIT;
