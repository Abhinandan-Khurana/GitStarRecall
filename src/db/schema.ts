export const DATABASE_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  topics_json TEXT NOT NULL DEFAULT '[]',
  language TEXT,
  html_url TEXT NOT NULL,
  stars INTEGER NOT NULL DEFAULT 0,
  forks INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  readme_url TEXT,
  readme_text TEXT,
  readme_etag TEXT,
  readme_last_modified TEXT,
  checksum TEXT,
  readme_retry_required INTEGER NOT NULL DEFAULT 0,
  last_synced_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  repo_id INTEGER NOT NULL,
  chunk_id TEXT NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  chunk_id TEXT NOT NULL,
  model TEXT NOT NULL,
  dimension INTEGER NOT NULL,
  vector_blob BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS index_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT NOT NULL PRIMARY KEY,
  query TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT NOT NULL PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS repo_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS repo_tag_assignments (
  repo_id INTEGER NOT NULL,
  tag_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (repo_id, tag_id),
  FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES repo_tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS session_context_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  repo_id INTEGER,
  chunk_id TEXT,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chunks_repo_id ON chunks(repo_id);
CREATE INDEX IF NOT EXISTS idx_chunks_created_at ON chunks(created_at);
CREATE INDEX IF NOT EXISTS idx_repo_tag_assignments_repo_id ON repo_tag_assignments(repo_id);
CREATE INDEX IF NOT EXISTS idx_session_context_items_session_id ON session_context_items(session_id);
`;
