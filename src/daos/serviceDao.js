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
    deposit: data.deposit !== undefined ? data.deposit : 0,
    require_deposit: data.require_deposit ? 1 : 0,
    category: data.category || null,
    description: data.description || null,
    is_active: data.is_active !== undefined ? data.is_active : 1
  });
};

const update = (id, data) => {
  const fields = {};
  if (data.name !== undefined) fields.name = data.name;
  if (data.duration_minutes !== undefined) fields.duration_minutes = data.duration_minutes;
  if (data.price !== undefined) fields.price = data.price;
  if (data.deposit !== undefined) fields.deposit = data.deposit;
  if (data.require_deposit !== undefined) fields.require_deposit = data.require_deposit ? 1 : 0;
  if (data.category !== undefined) fields.category = data.category;
  if (data.description !== undefined) fields.description = data.description;
  if (data.is_active !== undefined) fields.is_active = data.is_active;
  return db.update('services', id, fields);
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
