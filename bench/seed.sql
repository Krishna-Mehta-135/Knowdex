CREATE TABLE IF NOT EXISTS projectbench_seed (
  id integer PRIMARY KEY,
  content text NOT NULL
);

INSERT INTO projectbench_seed (id, content)
VALUES
  (1, 'ProjectBench deterministic seed note'),
  (2, 'A second local note for repeatable benchmark setup')
ON CONFLICT (id) DO NOTHING;
