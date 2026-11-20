-- This generated column is derived from Post.content. Drop it before Prisma
-- schema sync so Prisma doesn't require --accept-data-loss; the follow-up
-- pkg11-search-vector.sql recreates the column and index from source data.
DO $$
BEGIN
  IF to_regclass('public."Post"') IS NOT NULL THEN
    ALTER TABLE public."Post" DROP COLUMN IF EXISTS search_vector;
  END IF;
END
$$;
