-- Erdős Problem Solver Database Schema

CREATE TABLE problems (
  id INTEGER PRIMARY KEY,
  prize INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT CHECK(status IN ('open', 'solved', 'partial')),
  area TEXT,
  statement TEXT NOT NULL,
  history TEXT,
  last_updated TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  metadata JSON -- stores tags, related problems, etc.
);

CREATE TABLE problem_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id INTEGER NOT NULL,
  ref_type TEXT CHECK(ref_type IN ('arxiv', 'oeis', 'paper', 'blog', 'bibtex')),
  ref_id TEXT,
  title TEXT,
  url TEXT,
  FOREIGN KEY (problem_id) REFERENCES problems(id)
);

CREATE TABLE known_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id INTEGER NOT NULL,
  result_statement TEXT NOT NULL,
  author TEXT,
  year INTEGER,
  reference_url TEXT,
  FOREIGN KEY (problem_id) REFERENCES problems(id)
);

CREATE TABLE signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id INTEGER NOT NULL,
  signature_type TEXT CHECK(signature_type IN ('rh_trace', 'numerical', 'kk_kernel')),
  data BLOB NOT NULL, -- serialized signature
  metadata JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (problem_id) REFERENCES problems(id)
);

CREATE TABLE conjectures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id INTEGER NOT NULL,
  statement TEXT NOT NULL,
  rationale TEXT,
  status TEXT CHECK(status IN ('proposed', 'verified', 'disproved', 'experimental')),
  kk_score REAL,
  anomaly_score REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (problem_id) REFERENCES problems(id)
);

CREATE INDEX idx_problems_status ON problems(status);
CREATE INDEX idx_problems_prize ON problems(prize);
CREATE INDEX idx_problems_area ON problems(area);
CREATE INDEX idx_signatures_problem ON signatures(problem_id);
CREATE INDEX idx_conjectures_problem ON conjectures(problem_id);
