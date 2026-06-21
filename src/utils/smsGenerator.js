const configDao = require('../daos/configDao');
const { formatDateCN } = require('./timeUtils');

const renderTemplate = (template, data) => {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    return data[key] !== undefined ? String(data[key]) : '';
  });
};

const getSmsData = (booking) => {
  const storeName = configDao.getConfig('store_name');
  return {
    store_name: storeName,
    customer_name: booking.customer_name,
    date: formatDateCN(booking.booking_date),
    time: booking.start_time,
    service: booking.service_name || '',
    stylist: booking.employee_name || ''
  };
};

const generateConfirmSms = (booking) => {
  const template = configDao.getConfig('sms_template_confirm');
  const data = getSmsData(booking);
  return {
    phone: booking.customer_phone,
    content: renderTemplate(template, data)
  };
};

const generateRemindSms = (booking) => {
  const template = configDao.getConfig('sms_template_remind');
  const data = getSmsData(booking);
  return {
    phone: booking.customer_phone,
    content: renderTemplate(template, data)
  };
};

const generateCancelSms = (booking) => {
  const template = configDao.getConfig('sms_template_cancel');
  const data = getSmsData(booking);
  return {
    phone: booking.customer_phone,
    content: renderTemplate(template, data)
  };
};

const generateWaitlistNotifySms = (waitlistItem, availableSlot) => {
  const storeName = configDao.getConfig('store_name');
  const data = {
    store_name: storeName,
    customer_name: waitlistItem.customer_name,
    date: formatDateCN(waitlistItem.preferred_date),
    time: availableSlot.start_time,
    stylist: availableSlot.employee_name || '指定发型师'
  };
  const content = `【${data.store_name}】${data.customer_name}您好，${data.date} ${data.time}有空档啦！您候补的${data.stylist}时段已释放，请尽快确认预约。回T退订。`;
  return {
    phone: waitlistItem.customer_phone,
    content
  };
};

module.exports = {
  renderTemplate,
  generateConfirmSms,
  generateRemindSms,
  generateCancelSms,
  generateWaitlistNotifySms
};
