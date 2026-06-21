const db = require('../db');

const findAll = (filters = {}) => {
  let rows = db.findAll('services');
  if (filters.category) {
    rows = rows.filter(r => r.category === filters.category);
  }
  if (filters.is_active !== undefined) {
    rows = rows.filter(r => r.is_active === filters.is_active);
  }
  if (filters.maxDuration) {
    rows = rows.filter(r => r.duration_minutes <= parseInt(filters.maxDuration));
  }
  if (filters.minDuration) {
    rows = rows.filter(r => r.duration_minutes >= parseInt(filters.minDuration));
  }
  rows.sort((a, b) => {
    if (a.category !== b.category) return (a.category || '').localeCompare(b.category || '');
    return a.duration_minutes - b.duration_minutes;
  });
  return rows;
};

const findById = (id) => {
  return db.findById('services', id);
};

const findByIds = (ids) => {
  if (!ids || ids.length === 0) return [];
  return ids.map(id => db.findById('services', id)).filter(Boolean);
};

const create = (data) => {
  return db.insert('services', {
    name: data.name,
    duration_minutes: data.duration_minutes,
    price: data.price,
    category: data.category || null,
    description: data.description || null,
    is_active: data.is_active !== undefined ? data.is_active : 1
  });
};

const update = (id, data) => {
  return db.update('services', id, {
    name: data.name,
    duration_minutes: data.duration_minutes,
    price: data.price,
    category: data.category || null,
    description: data.description || null,
    is_active: data.is_active !== undefined ? data.is_active : 1
  });
};

const remove = (id) => {
  return db.remove('services', id);
};

module.exports = {
  findAll,
  findById,
  findByIds,
  create,
  update,
  remove
};
