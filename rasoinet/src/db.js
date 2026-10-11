const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS outlets (
  id INTEGER PRIMARY KEY, code TEXT UNIQUE, name TEXT, city TEXT, state TEXT, state_code TEXT,
  address TEXT, gstin TEXT, fssai_no TEXT, gst_scheme TEXT DEFAULT 'regular', seats INTEGER
);
CREATE TABLE IF NOT EXISTS channels (
  name TEXT PRIMARY KEY, commission_pct REAL DEFAULT 0, is_aggregator INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY, name TEXT, category TEXT, veg INTEGER, price REAL, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY, name TEXT, category TEXT, unit TEXT, cost REAL, gst_rate REAL, hsn TEXT, par_level REAL
);
CREATE TABLE IF NOT EXISTS recipes (
  menu_item_id INTEGER REFERENCES menu_items(id), item_id INTEGER REFERENCES inventory_items(id), qty REAL,
  PRIMARY KEY (menu_item_id, item_id)
);
CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY, name TEXT, gstin TEXT, state_code TEXT, phone TEXT, category TEXT
);
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY, outlet_id INTEGER, vendor_id INTEGER, date TEXT, invoice_no TEXT,
  taxable REAL, cgst REAL, sgst REAL, igst REAL, total REAL
);
CREATE TABLE IF NOT EXISTS purchase_lines (
  id INTEGER PRIMARY KEY, purchase_id INTEGER REFERENCES purchases(id), item_id INTEGER, qty REAL, rate REAL, gst_rate REAL
);
CREATE TABLE IF NOT EXISTS stock_counts (
  id INTEGER PRIMARY KEY, outlet_id INTEGER, item_id INTEGER, date TEXT, qty REAL,
  UNIQUE (outlet_id, item_id, date)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, outlet_id INTEGER, date TEXT, time TEXT, invoice_no TEXT UNIQUE, channel TEXT,
  payment_mode TEXT, covers INTEGER, subtotal REAL, discount REAL, taxable REAL, cgst REAL, sgst REAL,
  round_off REAL, total REAL, gst_by_eco INTEGER, eco_gst REAL
);
CREATE TABLE IF NOT EXISTS order_lines (
  id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES orders(id), menu_item_id INTEGER, qty INTEGER, price REAL
);
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY, outlet_id INTEGER, code TEXT, name TEXT, role TEXT, gender TEXT, state TEXT,
  basic REAL, hra REAL, allowances REAL, pf_enabled INTEGER, pf_capped INTEGER, uan TEXT, esic_no TEXT,
  phone TEXT, joined TEXT, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS payroll_adjustments (
  employee_id INTEGER, month TEXT, lop_days REAL DEFAULT 0, bonus REAL DEFAULT 0,
  PRIMARY KEY (employee_id, month)
);
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY, outlet_id INTEGER, employee_id INTEGER, date TEXT, start TEXT, end TEXT, station TEXT
);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY, outlet_id INTEGER, date TEXT, category TEXT, amount REAL, note TEXT
);
CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY, outlet_id INTEGER, type TEXT, number TEXT, authority TEXT, issued TEXT, expiry TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_outlet_date ON orders(outlet_id, date);
CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_purchases_outlet_date ON purchases(outlet_id, date);
CREATE INDEX IF NOT EXISTS idx_shifts_outlet_date ON shifts(outlet_id, date);
`;

function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDb, transaction };
