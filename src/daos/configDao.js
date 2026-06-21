const db = require('../db');

const getConfig = (key) => {
  const row = db.findOne('store_config', r => r.config_key === key);
  return row ? row.config_value : null;
};

const getAllConfigs = () => {
  return db.findAll('store_config');
};

const updateConfig = (key, value) => {
  return db.upsert('store_config', { config_key: key }, {
    config_key: key,
    config_value: String(value)
  });
};

const initDefaultConfigs = () => {
  const defaultConfigs = [
    ['business_start', '09:00', '营业开始时间'],
    ['business_end', '21:00', '营业结束时间'],
    ['time_slot_interval', '15', '时段间隔(分钟)'],
    ['store_name', '潮流理发店', '门店名称'],
    ['sms_template_confirm', '【{store_name}】{customer_name}您好，您预约的{date} {time} {service}已确认，发型师：{stylist}。如有变更请提前2小时致电。', '预约确认短信模板'],
    ['sms_template_remind', '【{store_name}】{customer_name}温馨提醒：您预约的{date} {time} {service}将于1小时后开始，请准时到店。发型师：{stylist}。', '预约提醒短信模板'],
    ['sms_template_cancel', '【{store_name}】{customer_name}您好，您的{date} {time}预约已取消。期待下次为您服务！', '预约取消短信模板']
  ];
  for (const [key, value, desc] of defaultConfigs) {
    db.upsert('store_config', { config_key: key }, {
      config_key: key,
      config_value: value,
      description: desc
    });
  }
};

module.exports = {
  getConfig,
  getAllConfigs,
  updateConfig,
  initDefaultConfigs
};
