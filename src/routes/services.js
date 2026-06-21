const express = require('express');
const router = express.Router();
const serviceDao = require('../daos/serviceDao');

router.get('/', (req, res) => {
  const { category, is_active, maxDuration, minDuration } = req.query;
  const filters = {};
  if (category) filters.category = category;
  if (is_active !== undefined) filters.is_active = parseInt(is_active);
  if (maxDuration) filters.maxDuration = parseInt(maxDuration);
  if (minDuration) filters.minDuration = parseInt(minDuration);
  const services = serviceDao.findAll(filters);
  res.json({ code: 0, data: services });
});

router.get('/:id', (req, res) => {
  const service = serviceDao.findById(parseInt(req.params.id));
  if (!service) {
    return res.status(404).json({ code: 1, message: '服务项目不存在' });
  }
  res.json({ code: 0, data: service });
});

router.get('/batch/query', (req, res) => {
  const { ids } = req.query;
  const idArray = (ids || '').split(',').map(Number).filter(n => !isNaN(n));
  const services = serviceDao.findByIds(idArray);
  res.json({ code: 0, data: services });
});

router.post('/', (req, res) => {
  const { name, duration_minutes, price, category, description, is_active, deposit, require_deposit } = req.body;
  if (!name || !duration_minutes || price === undefined) {
    return res.status(400).json({ code: 1, message: '名称、时长、价格必填' });
  }
  const service = serviceDao.create({
    name,
    duration_minutes: parseInt(duration_minutes),
    price: parseFloat(price),
    deposit: deposit !== undefined ? parseFloat(deposit) : undefined,
    require_deposit,
    category,
    description,
    is_active
  });
  res.json({ code: 0, data: service, message: '创建成功' });
});

router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!serviceDao.findById(id)) {
    return res.status(404).json({ code: 1, message: '服务项目不存在' });
  }
  const { name, duration_minutes, price, category, description, is_active, deposit, require_deposit } = req.body;
  const service = serviceDao.update(id, {
    name,
    duration_minutes: duration_minutes !== undefined ? parseInt(duration_minutes) : undefined,
    price: price !== undefined ? parseFloat(price) : undefined,
    deposit: deposit !== undefined ? parseFloat(deposit) : undefined,
    require_deposit,
    category,
    description,
    is_active
  });
  res.json({ code: 0, data: service, message: '更新成功' });
});

router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const info = serviceDao.remove(id);
  if (info.changes === 0) {
    return res.status(404).json({ code: 1, message: '服务项目不存在' });
  }
  res.json({ code: 0, message: '删除成功' });
});

module.exports = router;
