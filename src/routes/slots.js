const express = require('express');
const router = express.Router();
const { getAvailableSlotsForEmployee, getAvailableSlotsForService, getFreePeriodsForEmployee } = require('../utils/slotCalculator');
const serviceDao = require('../daos/serviceDao');
const employeeDao = require('../daos/employeeDao');
const { getDateStr } = require('../utils/timeUtils');

router.get('/employee/:employeeId', (req, res) => {
  const employeeId = parseInt(req.params.employeeId);
  let { date, duration } = req.query;
  if (!date) date = getDateStr();
  const requiredDuration = duration ? parseInt(duration) : 0;

  const slots = getAvailableSlotsForEmployee(employeeId, date, requiredDuration);
  const freePeriods = getFreePeriodsForEmployee(employeeId, date);
  const employee = employeeDao.findById(employeeId);

  res.json({
    code: 0,
    data: {
      employee_id: employeeId,
      employee_name: employee ? employee.name : null,
      date,
      slots,
      free_periods: freePeriods
    }
  });
});

router.get('/service/:serviceId', (req, res) => {
  const serviceId = parseInt(req.params.serviceId);
  let { date, employee_ids, max_duration } = req.query;
  if (!date) date = getDateStr();

  const mainService = serviceDao.findById(serviceId);
  if (!mainService) {
    return res.status(404).json({ code: 1, message: '服务项目不存在' });
  }

  let serviceDuration = mainService.duration_minutes;
  if (max_duration) {
    serviceDuration = Math.min(serviceDuration, parseInt(max_duration));
  }

  let employeeIdList = null;
  if (employee_ids) {
    employeeIdList = employee_ids.split(',').map(Number).filter(n => !isNaN(n));
  }

  const result = getAvailableSlotsForService(date, serviceDuration, employeeIdList);

  res.json({
    code: 0,
    data: {
      service_id: serviceId,
      service_name: mainService.name,
      service_duration: serviceDuration,
      date,
      stylists: Object.values(result)
    }
  });
});

router.get('/free-periods/:employeeId', (req, res) => {
  const employeeId = parseInt(req.params.employeeId);
  let { date } = req.query;
  if (!date) date = getDateStr();

  const periods = getFreePeriodsForEmployee(employeeId, date);
  res.json({ code: 0, data: periods });
});

router.get('/quick-check', (req, res) => {
  const { employee_id, date, start_time, duration } = req.query;
  if (!employee_id || !date || !start_time || !duration) {
    return res.status(400).json({ code: 1, message: '参数不完整' });
  }
  const slots = getAvailableSlotsForEmployee(parseInt(employee_id), date, parseInt(duration));
  const isAvailable = slots.some(s => s.start_time === start_time);
  res.json({
    code: 0,
    data: { available: isAvailable }
  });
});

module.exports = router;
