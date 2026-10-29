-- packages/server/migrations/004_polyp_owner.sql
--
-- "My polyps" provenance (issue #112). owner_hash is a server-side hash of the
-- client's owner token (see src/ownerHash.ts); NULL for polyps planted by
-- clients that predate this column or that send no token. Runs exactly once
-- via schema_migrations, so the bare ADD COLUMN is safe.

ALTER TABLE polyps ADD COLUMN owner_hash TEXT;

-- Serves both "list my polyps" and "my most recent polyp" (MAX(id)).
CREATE INDEX IF NOT EXISTS idx_polyps_owner
  ON polyps (owner_hash, id) WHERE owner_hash IS NOT NULL;
