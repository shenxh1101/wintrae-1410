const express = require('express');
const router = express.Router();
const scheduleDao = require('../daos/scheduleDao');
const employeeDao = require('../daos/employeeDao');
const { getDateStr } = require('../utils/timeUtils');

router.get('/', (req, res) => {
  let { start_date, end_date, employee_id } = req.query;
  if (!start_date) start_date = getDateStr();
  if (!end_date) end_date = start_date;
  const empId = employee_id ? parseInt(employee_id) : null;
  const schedules = scheduleDao.findByDateRange(start_date, end_date, empId);
  res.json({ code: 0, data: schedules });
});

router.get('/employee/:employeeId/:date', (req, res) => {
  const employeeId = parseInt(req.params.employeeId);
  const { date } = req.params;
  const schedule = scheduleDao.findByEmployeeAndDate(employeeId, date);
  res.json({ code: 0, data: schedule });
});

router.post('/', (req, res) => {
  const { employee_id, schedule_date, start_time, end_time, is_day_off, break_start, break_end, note } = req.body;
  if (!employee_id || !schedule_date || !start_time || !end_time) {
    return res.status(400).json({ code: 1, message: '员工ID、日期、开始时间、结束时间必填' });
  }
  if (!employeeDao.findById(parseInt(employee_id))) {
    return res.status(404).json({ code: 1, message: '员工不存在' });
  }
  const schedule = scheduleDao.upsert({
    employee_id: parseInt(employee_id),
    schedule_date,
    start_time,
    end_time,
    is_day_off: is_day_off ? 1 : 0,
    break_start,
    break_end,
    note
  });
  res.json({ code: 0, data: schedule, message: '排班保存成功' });
});

router.post('/bulk', (req, res) => {
  const { schedules } = req.body;
  if (!Array.isArray(schedules) || schedules.length === 0) {
    return res.status(400).json({ code: 1, message: '排班数据不能为空' });
  }
  const results = scheduleDao.bulkUpsert(schedules.map(s => ({
    ...s,
    employee_id: parseInt(s.employee_id),
    is_day_off: s.is_day_off ? 1 : 0
  })));
  res.json({ code: 0, data: results, message: `批量保存${results.length}条排班成功` });
});

router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const info = scheduleDao.remove(id);
  if (info.changes === 0) {
    return res.status(404).json({ code: 1, message: '排班不存在' });
  }
  res.json({ code: 0, message: '删除成功' });
});

router.delete('/employee/:employeeId/:date', (req, res) => {
  const employeeId = parseInt(req.params.employeeId);
  const { date } = req.params;
  scheduleDao.removeByEmployeeAndDate(employeeId, date);
  res.json({ code: 0, message: '删除成功' });
});

module.exports = router;
