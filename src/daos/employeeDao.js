const db = require('../db');

const ROLES = ['stylist', 'assistant', 'manager'];
const STATUSES = ['active', 'inactive', 'leave'];

const findAll = (filters = {}) => {
  let rows = db.findAll('employees');
  if (filters.role && ROLES.includes(filters.role)) {
    rows = rows.filter(r => r.role === filters.role);
  }
  if (filters.status && STATUSES.includes(filters.status)) {
    rows = rows.filter(r => r.status === filters.status);
  }
  rows.sort((a, b) => {
    const roleOrder = ROLES.indexOf(a.role) - ROLES.indexOf(b.role);
    if (roleOrder !== 0) return roleOrder;
    return a.id - b.id;
  });
  return rows;
};

const findById = (id) => {
  return db.findById('employees', id);
};

const create = (data) => {
  return db.insert('employees', {
    name: data.name,
    role: data.role,
    phone: data.phone || null,
    station_number: data.station_number || null,
    status: data.status || 'active'
  });
};

const update = (id, data) => {
  return db.update('employees', id, {
    name: data.name,
    role: data.role,
    phone: data.phone || null,
    station_number: data.station_number || null,
    status: data.status || 'active'
  });
};

const remove = (id) => {
  return db.remove('employees', id);
};

module.exports = {
  findAll,
  findById,
  create,
  update,
  remove
};
