const db = require('../db');
const employeeDao = require('./employeeDao');
const serviceDao = require('./serviceDao');

const enrich = (w) => {
  if (!w) return null;
  const emp = w.employee_id ? employeeDao.findById(w.employee_id) : null;
  const svc = serviceDao.findById(w.service_id);
  return {
    ...w,
    employee_name: emp ? emp.name : null,
    service_name: svc ? svc.name : null,
    duration_minutes: svc ? svc.duration_minutes : null
  };
};

const findAll = (filters = {}) => {
  let rows = db.findAll('waitlist');
  if (filters.preferred_date) {
    rows = rows.filter(r => r.preferred_date === filters.preferred_date);
  }
  if (filters.start_date && filters.end_date) {
    rows = rows.filter(r => r.preferred_date >= filters.start_date && r.preferred_date <= filters.end_date);
  }
  if (filters.status) {
    rows = rows.filter(r => r.status === filters.status);
  }
  if (filters.employee_id) {
    rows = rows.filter(r => r.employee_id === filters.employee_id);
  }
  rows.sort((a, b) => {
    const d = a.preferred_date.localeCompare(b.preferred_date);
    if (d !== 0) return d;
    return a.id - b.id;
  });
  return rows.map(enrich);
};

const findById = (id) => {
  return enrich(db.findById('waitlist', id));
};

const create = (data) => {
  const record = db.insert('waitlist', {
    customer_name: data.customer_name,
    customer_phone: data.customer_phone,
    employee_id: data.employee_id || null,
    service_id: data.service_id,
    preferred_date: data.preferred_date,
    preferred_times: data.preferred_times || null,
    hair_note: data.hair_note || null,
    remark: data.remark || null,
    status: data.status || 'waiting',
    notified_at: null
  });
  return findById(record.id);
};

const updateStatus = (id, status) => {
  const updates = { status };
  if (status === 'notified') {
    updates.notified_at = new Date().toISOString();
  }
  db.update('waitlist', id, updates);
  return findById(id);
};

const remove = (id) => {
  return db.remove('waitlist', id);
};

module.exports = {
  findAll,
  findById,
  create,
  updateStatus,
  remove
};
