-- ACSES Election System Database Schema
-- Compatible with PostgreSQL and SQLite

-- 1. Users Table (Pre-populated from Roster)
CREATE TABLE IF NOT EXISTS users (
  reference_number VARCHAR(64) PRIMARY KEY,
  full_name VARCHAR(255) NOT NULL,
  gender VARCHAR(10) NOT NULL, -- 'MALE' or 'FEMALE'
  program VARCHAR(100) NOT NULL, -- 'COMPUTER SCIENCE', 'CYBERSECURITY', 'ROBOTICS & AI', 'INFORMATION SYSTEMS & TECHNOLOGY'
  class_section VARCHAR(20) NOT NULL, -- 'Class A' or 'Class B'
  whatsapp_number VARCHAR(30) DEFAULT '',
  password_hash VARCHAR(255) NOT NULL, -- Hashed voter password
  has_voted BOOLEAN DEFAULT 0,
  is_candidate BOOLEAN DEFAULT 0,
  role VARCHAR(20) DEFAULT 'voter' -- 'voter' or 'admin'
);

-- 2. Program Links Table (Dynamic WhatsApp Community Links)
CREATE TABLE IF NOT EXISTS program_links (
  program VARCHAR(100) PRIMARY KEY,
  main_group_link VARCHAR(255) NOT NULL,
  discussion_link VARCHAR(255) NOT NULL,
  class_a_link VARCHAR(255) NOT NULL,
  class_b_link VARCHAR(255) NOT NULL
);

-- 3. Candidates Table
CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference_number VARCHAR(64) NOT NULL,
  program VARCHAR(100) NOT NULL,
  position VARCHAR(100) NOT NULL, -- e.g., 'Male Course Representative', 'Female Course Representative'
  photo_url VARCHAR(500) NOT NULL,
  slogan VARCHAR(255) DEFAULT '',
  manifesto TEXT NOT NULL,
  is_approved BOOLEAN DEFAULT 0,
  FOREIGN KEY (reference_number) REFERENCES users(reference_number)
);

-- 4. Votes Table (Anonymous Ballot Box)
-- NOTE: Intentionally excludes reference_number to guarantee complete voter anonymity.
CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL,
  program VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES candidates(id)
);

-- 5. System Settings (Election Master Switch & Config)
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(64) PRIMARY KEY,
  value VARCHAR(255) NOT NULL
);

-- 6. Cohort Rebalance Logs (Dual-Gender Rule Audit)
CREATE TABLE IF NOT EXISTS rebalance_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL,
  reference_number VARCHAR(64) NOT NULL,
  student_name VARCHAR(255) NOT NULL,
  program VARCHAR(100) NOT NULL,
  gender VARCHAR(10) NOT NULL,
  from_class VARCHAR(20) NOT NULL,
  to_class VARCHAR(20) NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

