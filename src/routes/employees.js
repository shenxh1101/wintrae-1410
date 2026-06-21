const express = require('express');
const router = express.Router();
const employeeDao = require('../daos/employeeDao');

router.get('/', (req, res) => {
  const { role, status } = req.query;
  const filters = {};
  if (role) filters.role = role;
  if (status) filters.status = status;
  const employees = employeeDao.findAll(filters);
  res.json({ code: 0, data: employees });
});

router.get('/:id', (req, res) => {
  const employee = employeeDao.findById(parseInt(req.params.id));
  if (!employee) {
    return res.status(404).json({ code: 1, message: '员工不存在' });
  }
  res.json({ code: 0, data: employee });
});

router.post('/', (req, res) => {
  const { name, role, phone, station_number, status } = req.body;
  if (!name || !role) {
    return res.status(400).json({ code: 1, message: '姓名和角色必填' });
  }
  if (!['stylist', 'assistant', 'manager'].includes(role)) {
    return res.status(400).json({ code: 1, message: '角色必须是 stylist/assistant/manager' });
  }
  const employee = employeeDao.create({ name, role, phone, station_number, status });
  res.json({ code: 0, data: employee, message: '创建成功' });
});

router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!employeeDao.findById(id)) {
    return res.status(404).json({ code: 1, message: '员工不存在' });
  }
  const { name, role, phone, station_number, status } = req.body;
  if (!name || !role) {
    return res.status(400).json({ code: 1, message: '姓名和角色必填' });
  }
  const employee = employeeDao.update(id, { name, role, phone, station_number, status });
  res.json({ code: 0, data: employee, message: '更新成功' });
});

router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const info = employeeDao.remove(id);
  if (info.changes === 0) {
    return res.status(404).json({ code: 1, message: '员工不存在' });
  }
  res.json({ code: 0, message: '删除成功' });
});

module.exports = router;
