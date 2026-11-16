CREATE TABLE IF NOT EXISTS projectbench_seed (
  id integer PRIMARY KEY,
  content text NOT NULL
);

INSERT INTO projectbench_seed (id, content)
VALUES
  (1, 'ProjectBench deterministic seed note'),
  (2, 'A second local note for repeatable benchmark setup')
ON CONFLICT (id) DO NOTHING;

-- The WebSocket upgrade checks the real Prisma User and Content tables.
-- These stable IDs are local-only and are paired with the benchmark JWT.
INSERT INTO "User" (id, username, email, password)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'projectbench-user',
  'projectbench-user@localhost.invalid',
  NULL
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO "Content" (id, title, link, type, "userId", "isPublic", "createdAt", "updatedAt")
VALUES (
  '00000000-0000-4000-8000-000000000002',
  'ProjectBench Knowdex document',
  'projectbench://knowdex-coalesce',
  'document',
  '00000000-0000-4000-8000-000000000001',
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO NOTHING;
