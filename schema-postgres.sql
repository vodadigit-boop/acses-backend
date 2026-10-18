-- ============================================================================
-- ACSES Election Web App - PostgreSQL Production Schema
-- Designed for deployment on Supabase, Render, or Neon PostgreSQL
-- ============================================================================

-- Table 1: users (Pre-populated from Roster)
CREATE TABLE IF NOT EXISTS users (
  reference_number VARCHAR(64) PRIMARY KEY,
  full_name VARCHAR(255) NOT NULL,
  gender VARCHAR(10) NOT NULL CHECK (gender IN ('MALE', 'FEMALE')),
  program VARCHAR(100) NOT NULL,
  class_section VARCHAR(20) NOT NULL CHECK (class_section IN ('Class A', 'Class B')),
  password_hash VARCHAR(255) NOT NULL,
  has_voted BOOLEAN DEFAULT FALSE,
  is_candidate BOOLEAN DEFAULT FALSE,
  role VARCHAR(20) DEFAULT 'voter' CHECK (role IN ('voter', 'admin'))
);

-- Table 2: program_links (Dynamic WhatsApp Links)
CREATE TABLE IF NOT EXISTS program_links (
  program VARCHAR(100) PRIMARY KEY,
  main_group_link VARCHAR(255) NOT NULL,
  discussion_link VARCHAR(255) NOT NULL,
  class_a_link VARCHAR(255) NOT NULL,
  class_b_link VARCHAR(255) NOT NULL
);

-- Table 3: candidates
CREATE TABLE IF NOT EXISTS candidates (
  id SERIAL PRIMARY KEY,
  reference_number VARCHAR(64) REFERENCES users(reference_number) ON DELETE CASCADE,
  program VARCHAR(100) NOT NULL,
  position VARCHAR(100) NOT NULL DEFAULT 'Course Representative',
  photo_url VARCHAR(500) NOT NULL,
  slogan VARCHAR(255) DEFAULT '',
  manifesto TEXT NOT NULL,
  is_approved BOOLEAN DEFAULT FALSE
);

-- Table 4: votes (Anonymous Ballot Box)
-- NOTE: The votes table intentionally excludes reference_number to guarantee complete voter anonymity.
CREATE TABLE IF NOT EXISTS votes (
  id SERIAL PRIMARY KEY,
  candidate_id INTEGER REFERENCES candidates(id) ON DELETE RESTRICT,
  program VARCHAR(100) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table 5: settings (Global Election Master State)
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(64) PRIMARY KEY,
  value VARCHAR(255) NOT NULL
);

-- Default Settings
INSERT INTO settings (key, value)
VALUES ('election_status', 'active')
ON CONFLICT (key) DO NOTHING;

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_users_program ON users(program);
CREATE INDEX IF NOT EXISTS idx_candidates_program ON candidates(program, is_approved);
CREATE INDEX IF NOT EXISTS idx_votes_candidate ON votes(candidate_id);
CREATE INDEX IF NOT EXISTS idx_votes_program ON votes(program);
