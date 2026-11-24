CREATE TABLE IF NOT EXISTS test_companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS test_financial_transactions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  description TEXT,
  customer_or_supplier_name TEXT,
  category_name TEXT,
  cost_center_name TEXT,
  amount REAL NOT NULL DEFAULT 0,
  due_date TEXT,
  payment_date TEXT,
  competence_date TEXT,
  status TEXT NOT NULL,
  raw_payload TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, transaction_type, external_id)
);

CREATE INDEX IF NOT EXISTS idx_test_financial_transactions_company_date
  ON test_financial_transactions(company_id, competence_date);

CREATE INDEX IF NOT EXISTS idx_test_financial_transactions_company_type
  ON test_financial_transactions(company_id, transaction_type);

CREATE TABLE IF NOT EXISTS test_sync_runs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  received_count INTEGER NOT NULL DEFAULT 0,
  payable_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL
);

INSERT OR IGNORE INTO test_companies (id, name, source)
VALUES ('w2-test', 'W2 Test', 'conta_azul');

CREATE TABLE IF NOT EXISTS conta_azul_request_slots (
  account TEXT PRIMARY KEY,
  next_at INTEGER NOT NULL
);
