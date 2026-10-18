const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const dbPath = path.join(__dirname, 'acses.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode and foreign keys for high performance and integrity
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Initialize Tables
function initSchema() {
  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schemaSql);

  // Safe migration for slogan column
  try {
    db.exec("ALTER TABLE candidates ADD COLUMN slogan VARCHAR(255) DEFAULT '';");
  } catch (_) {}

  // Safe migration for whatsapp_number column
  try {
    db.exec("ALTER TABLE users ADD COLUMN whatsapp_number VARCHAR(30) DEFAULT '';");
  } catch (_) {}

  // Initialize election status if not present
  const checkSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('election_status');
  if (!checkSetting) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('election_status', 'active');
  }
}

initSchema();

module.exports = {
  db,
  initSchema
};
