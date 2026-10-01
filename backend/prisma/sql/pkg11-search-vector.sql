-- PKG-11: Full-text search tiếng Việt
-- unaccent() không immutable nên bọc trong hàm wrapper IMMUTABLE (chuẩn mức cộng đồng).
-- Idempotent — chạy an toàn nhiều lần.

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION immutable_unaccent(text)
RETURNS text AS $$
  SELECT unaccent('unaccent', $1);
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

ALTER TABLE "Post" DROP COLUMN IF EXISTS "search_vector";

ALTER TABLE "Post" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  to_tsvector('simple', immutable_unaccent(coalesce("content", '')))
) STORED;

CREATE INDEX IF NOT EXISTS "Post_search_vector_idx" ON "Post" USING GIN ("search_vector");
