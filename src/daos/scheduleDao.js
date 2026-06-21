const db = require('../db');
const employeeDao = require('./employeeDao');

const enrich = (s) => {
  const emp = employeeDao.findById(s.employee_id);
  return {
    ...s,
    employee_name: emp ? emp.name : null,
    employee_role: emp ? emp.role : null,
    station_number: emp ? emp.station_number : null
  };
};

const findByDateRange = (startDate, endDate, employeeId = null) => {
  let rows = db.findMany('schedules', r =>
    r.schedule_date >= startDate && r.schedule_date <= endDate
  );
  if (employeeId) {
    rows = rows.filter(r => r.employee_id === employeeId);
  }
  rows.sort((a, b) => {
    const d = a.schedule_date.localeCompare(b.schedule_date);
    if (d !== 0) return d;
    return a.employee_id - b.employee_id;
  });
  return rows.map(enrich);
};

const findByEmployeeAndDate = (employeeId, date) => {
  const row = db.findOne('schedules', r =>
    r.employee_id === employeeId && r.schedule_date === date
  );
  return row ? enrich(row) : null;
};

const findById = (id) => {
  return db.findById('schedules', id);
};

const upsert = (data) => {
  const record = db.upsert('schedules', r =>
    r.employee_id === data.employee_id && r.schedule_date === data.schedule_date,
  {
    employee_id: data.employee_id,
    schedule_date: data.schedule_date,
    start_time: data.start_time,
    end_time: data.end_time,
    is_day_off: data.is_day_off || 0,
    break_start: data.break_start || null,
    break_end: data.break_end || null,
    note: data.note || null
  });
  return record;
};

const bulkUpsert = (schedules) => {
  const results = [];
  for (const data of schedules) {
    results.push(upsert(data));
  }
  return results;
};

const remove = (id) => {
  return db.remove('schedules', id);
};

const removeByEmployeeAndDate = (employeeId, date) => {
  return db.remove('schedules', r =>
    r.employee_id === employeeId && r.schedule_date === date
  );
};

module.exports = {
  findByDateRange,
  findByEmployeeAndDate,
  findById,
  upsert,
  bulkUpsert,
  remove,
  removeByEmployeeAndDate
};
