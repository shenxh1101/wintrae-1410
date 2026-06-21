const express = require('express');
const router = express.Router();
const configDao = require('../daos/configDao');
const { generateConfirmSms, generateRemindSms, generateCancelSms } = require('../utils/smsGenerator');
const bookingDao = require('../daos/bookingDao');

router.get('/configs', (req, res) => {
  const configs = configDao.getAllConfigs();
  const result = {};
  for (const c of configs) {
    result[c.config_key] = { value: c.config_value, description: c.description };
  }
  res.json({ code: 0, data: result });
});

router.put('/configs', (req, res) => {
  const updates = req.body;
  const changed = [];
  for (const [key, value] of Object.entries(updates)) {
    configDao.updateConfig(key, String(value));
    changed.push(key);
  }
  res.json({ code: 0, data: { updated_keys: changed }, message: '配置更新成功' });
});

router.post('/sms/preview', (req, res) => {
  const { booking_id, type } = req.body;
  if (!booking_id) {
    return res.status(400).json({ code: 1, message: 'booking_id 必填' });
  }
  const booking = bookingDao.findById(parseInt(booking_id));
  if (!booking) {
    return res.status(404).json({ code: 1, message: '预约不存在' });
  }

  let sms = null;
  switch (type || 'confirm') {
    case 'remind':
      sms = generateRemindSms(booking);
      break;
    case 'cancel':
      sms = generateCancelSms(booking);
      break;
    default:
      sms = generateConfirmSms(booking);
  }

  res.json({ code: 0, data: sms });
});

module.exports = router;
