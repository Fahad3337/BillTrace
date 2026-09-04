CREATE TABLE IF NOT EXISTS users (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'viewer')),
  created_at    text NOT NULL
);

CREATE TABLE IF NOT EXISTS bills (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bill_number text NOT NULL UNIQUE,
  bill_date   text,
  note        text,
  created_at  text NOT NULL,
  created_by  integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at  text,
  updated_by  integer REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_bills_bill_number ON bills(bill_number);
CREATE INDEX IF NOT EXISTS idx_bills_bill_date ON bills(bill_date);

-- bill_id is intentionally NOT a foreign key: audit rows must outlive the bills they describe.
CREATE TABLE IF NOT EXISTS audit_log (
  id       integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ts       text NOT NULL,
  user_id  integer,
  username text,
  action   text NOT NULL,
  bill_id  integer,
  details  text
);

CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
