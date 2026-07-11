// Simple backend for the pharmacy pricing dashboard.
//
// It does exactly one job: persist the parsed dashboard data (which used to
// live only in the browser tab's memory) into a small SQLite database, so
// that anyone on the team who opens the app sees the last-uploaded data
// automatically instead of having to re-upload Excel files every time.
//
// All the Excel parsing / analysis logic still runs in the browser exactly
// as before (nothing about the spreadsheet-reading code changed) - this
// server only stores and returns the resulting JSON snapshot.

const fs = require('fs');
const path = require('path');
const express = require('express');
const compression = require('compression');
const { DatabaseSync } = require('node:sqlite'); // built into Node 22+, no native build step needed

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'dashboard.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT
  );
`);

const app = express();
app.use(compression());
app.use(express.json({ limit: '80mb' })); // pricing/sales snapshots can be sizeable

// ---- API ----------------------------------------------------------------

// Return the last saved snapshot (or null if nothing has been saved yet).
app.get('/api/load', (req, res) => {
  const row = db.prepare('SELECT payload, updated_at, updated_by FROM snapshot WHERE id = 1').get();
  if (!row) return res.json({ data: null });
  res.json({
    data: JSON.parse(row.payload),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by || null,
  });
});

// Save (overwrite) the current snapshot.
app.post('/api/save', (req, res) => {
  const { data, updatedBy } = req.body || {};
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'missing data' });
  }
  const payload = JSON.stringify(data);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO snapshot (id, payload, updated_at, updated_by)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `).run(payload, now, updatedBy || null);
  res.json({ ok: true, updatedAt: now });
});

// Clear the saved snapshot (used by the "reupload / start over" flow).
app.delete('/api/clear', (req, res) => {
  db.prepare('DELETE FROM snapshot WHERE id = 1').run();
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Pricing dashboard running on http://localhost:${PORT}`);
});
