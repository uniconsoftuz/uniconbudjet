CREATE TABLE admins (
  telegram_id INTEGER PRIMARY KEY,
  name        TEXT,
  perms       TEXT NOT NULL DEFAULT '',
  added_by    INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE collection_members (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, employee_id)
);

CREATE TABLE collections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT,
  amount      INTEGER NOT NULL DEFAULT 0,
  deadline    TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at   TEXT
, grp TEXT, source_update_id INTEGER);

CREATE TABLE "employees" (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          first_name    TEXT,
          last_name     TEXT,
          phone         TEXT NOT NULL UNIQUE,
          grp           TEXT NOT NULL DEFAULT 'boshqarma',
          position      TEXT,
          department    TEXT,
          birth_date    TEXT,
          note          TEXT,
          telegram_id   INTEGER UNIQUE,
          tg_username   TEXT,
          is_active     INTEGER NOT NULL DEFAULT 1,
          created_by    INTEGER,
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          linked_at     TEXT,
          registered_at TEXT
        );

CREATE TABLE expenses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  amount        INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
  photo_file_id TEXT,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  source_update_id INTEGER
);

CREATE TABLE payment_requests (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
          employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          amount        INTEGER NOT NULL,
          file_id       TEXT NOT NULL,
          file_kind     TEXT NOT NULL DEFAULT 'photo',
          status        TEXT NOT NULL DEFAULT 'pending',
          reason        TEXT,
          payment_id    INTEGER,
          reviewed_by   INTEGER,
          reviewed_at   TEXT,
          created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        , method TEXT NOT NULL DEFAULT 'click', source_update_id INTEGER, review_update_id INTEGER);

CREATE TABLE payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
  employee_id   INTEGER NOT NULL REFERENCES employees(id),
  amount        INTEGER NOT NULL,
  accepted_by   INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
, method TEXT NOT NULL DEFAULT 'naqd', source_update_id INTEGER);

CREATE TABLE reminder_log (
  day     TEXT NOT NULL,
  slot    TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (day, slot)
);

CREATE TABLE request_msgs (
          request_id INTEGER NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
          chat_id    INTEGER NOT NULL,
          message_id INTEGER NOT NULL
        );

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE form_sessions (
  telegram_id INTEGER PRIMARY KEY,
  step TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE processed_updates (
  update_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'processing',
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  touched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_payments_collection_employee ON payments(collection_id, employee_id);
CREATE INDEX idx_requests_pending ON payment_requests(collection_id, employee_id, status);
CREATE INDEX idx_members_employee ON collection_members(employee_id);
CREATE INDEX idx_expenses_collection ON expenses(collection_id);
CREATE INDEX idx_processed_updates_received ON processed_updates(received_at);
CREATE UNIQUE INDEX idx_collections_source_update ON collections(source_update_id);
CREATE UNIQUE INDEX idx_payments_source_update ON payments(source_update_id);
CREATE UNIQUE INDEX idx_expenses_source_update ON expenses(source_update_id);
CREATE UNIQUE INDEX idx_requests_source_update ON payment_requests(source_update_id);

CREATE TRIGGER collection_members_on_create AFTER INSERT ON collections BEGIN
  INSERT INTO collection_members (collection_id, employee_id)
  SELECT NEW.id, id FROM employees
  WHERE is_active = 1 AND (NEW.grp IS NULL OR grp = NEW.grp);
END;

CREATE TRIGGER payment_on_request_approval AFTER UPDATE OF status ON payment_requests
WHEN OLD.status = 'pending' AND NEW.status = 'approved' BEGIN
  INSERT OR IGNORE INTO collection_members (collection_id, employee_id)
  SELECT NEW.collection_id, NEW.employee_id WHERE NEW.collection_id IS NOT NULL;
  INSERT INTO payments (collection_id, employee_id, amount, accepted_by, method, source_update_id)
  VALUES (NEW.collection_id, NEW.employee_id, NEW.amount, NEW.reviewed_by, NEW.method, NEW.review_update_id);
  UPDATE payment_requests SET payment_id = last_insert_rowid() WHERE id = NEW.id;
END;

