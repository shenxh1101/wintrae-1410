const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', '..', 'data');
const dbFile = path.join(dataDir, 'database.json');

let db = null;
let saveTimer = null;

const DEFAULT_DB = {
  meta: { version: 1, initialized: false },
  store_config: [],
  employees: [],
  services: [],
  schedules: [],
  bookings: [],
  waitlist: [],
  counters: {
    employees: 0,
    services: 0,
    schedules: 0,
    bookings: 0,
    waitlist: 0
  }
};

const ensureDir = () => {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
};

const load = () => {
  ensureDir();
  if (!fs.existsSync(dbFile)) {
    db = JSON.parse(JSON.stringify(DEFAULT_DB));
    persist(true);
    return db;
  }
  try {
    const raw = fs.readFileSync(dbFile, 'utf-8');
    db = JSON.parse(raw);
  } catch (e) {
    console.error('数据库加载失败，使用默认数据库:', e.message);
    db = JSON.parse(JSON.stringify(DEFAULT_DB));
  }
  return db;
};

const persist = (sync = false) => {
  ensureDir();
  const save = () => {
    try {
      fs.writeFileSync(dbFile, JSON.stringify(db, null, 2), 'utf-8');
    } catch (e) {
      console.error('数据库保存失败:', e.message);
    }
  };
  if (sync) {
    save();
  } else {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 100);
  }
};

const getDb = () => {
  if (!db) load();
  return db;
};

const nextId = (table) => {
  getDb();
  db.counters[table] = (db.counters[table] || 0) + 1;
  return db.counters[table];
};

const now = () => new Date().toISOString();

const findAll = (table, filters = {}) => {
  getDb();
  let rows = db[table] || [];
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      rows = rows.filter(r => value.includes(r[key]));
    } else {
      rows = rows.filter(r => r[key] === value);
    }
  }
  return rows.map(r => ({ ...r }));
};

const findById = (table, id) => {
  getDb();
  const rows = db[table] || [];
  const row = rows.find(r => r.id === id);
  return row ? { ...row } : null;
};

const findOne = (table, predicate) => {
  getDb();
  const rows = db[table] || [];
  const row = rows.find(predicate);
  return row ? { ...row } : null;
};

const findMany = (table, predicate) => {
  getDb();
  const rows = db[table] || [];
  return rows.filter(predicate).map(r => ({ ...r }));
};

const insert = (table, data) => {
  getDb();
  if (!db[table]) db[table] = [];
  const id = nextId(table);
  const record = {
    id,
    created_at: now(),
    updated_at: now(),
    ...data
  };
  db[table].push(record);
  persist();
  return { ...record };
};

const update = (table, id, data) => {
  getDb();
  const rows = db[table] || [];
  const idx = rows.findIndex(r => r.id === id);
  if (idx === -1) return null;
  rows[idx] = {
    ...rows[idx],
    ...data,
    id,
    updated_at: now()
  };
  persist();
  return { ...rows[idx] };
};

const upsert = (table, uniqueKey, data) => {
  getDb();
  const rows = db[table] || [];
  const predicate = (r) => {
    if (typeof uniqueKey === 'function') return uniqueKey(r);
    return Object.entries(uniqueKey).every(([k, v]) => r[k] === v);
  };
  const idx = rows.findIndex(predicate);
  if (idx !== -1) {
    const id = rows[idx].id;
    rows[idx] = {
      ...rows[idx],
      ...data,
      id,
      updated_at: now()
    };
    persist();
    return { ...rows[idx] };
  } else {
    return insert(table, data);
  }
};

const remove = (table, idOrPredicate) => {
  getDb();
  const rows = db[table] || [];
  let count = 0;
  if (typeof idOrPredicate === 'function') {
    const before = rows.length;
    db[table] = rows.filter(r => !idOrPredicate(r));
    count = before - db[table].length;
  } else {
    const before = rows.length;
    db[table] = rows.filter(r => r.id !== idOrPredicate);
    count = before - db[table].length;
  }
  persist();
  return { changes: count };
};

const transaction = (fn) => {
  getDb();
  const snapshot = JSON.parse(JSON.stringify(db));
  try {
    const result = fn({
      findAll: (t, f) => findAll(t, f),
      findById: (t, id) => findById(t, id),
      findOne: (t, p) => findOne(t, p),
      findMany: (t, p) => findMany(t, p),
      insert: (t, d) => insert(t, d),
      update: (t, id, d) => update(t, id, d),
      upsert: (t, uk, d) => upsert(t, uk, d),
      remove: (t, id) => remove(t, id)
    });
    persist(true);
    return result;
  } catch (e) {
    db = snapshot;
    persist(true);
    throw e;
  }
};

module.exports = {
  load,
  persist,
  getDb,
  nextId,
  now,
  findAll,
  findById,
  findOne,
  findMany,
  insert,
  update,
  upsert,
  remove,
  transaction
};
