const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const employeesRouter = require('./routes/employees');
const servicesRouter = require('./routes/services');
const schedulesRouter = require('./routes/schedules');
const slotsRouter = require('./routes/slots');
const bookingsRouter = require('./routes/bookings');
const waitlistRouter = require('./routes/waitlist');
const adminRouter = require('./routes/admin');
const systemRouter = require('./routes/system');
const customersRouter = require('./routes/customers');
const db = require('./db');
const configDao = require('./daos/configDao');
const { getDateStr } = require('./utils/timeUtils');

const dbPath = path.join(__dirname, '..', 'data', 'database.json');
if (!fs.existsSync(dbPath)) {
  console.log('数据库不存在，正在初始化...');
  db.load();
  configDao.initDefaultConfigs();
  console.log('正在插入示例数据...');
  require('./scripts/seedData');
} else {
  db.load();
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`  → ${res.statusCode} ${duration}ms`);
  });
  next();
});

app.get('/', (req, res) => {
  res.json({
    code: 0,
    message: '理发店预约排班服务 API',
    version: '1.0.0',
    docs: {
      employees: '/api/employees - 员工管理',
      services: '/api/services - 服务项目',
      schedules: '/api/schedules - 排班管理',
      slots: '/api/slots - 可约时段查询',
      bookings: '/api/bookings - 预约管理',
      waitlist: '/api/waitlist - 候补名单',
      admin: '/api/admin/dashboard/:date - 管理端统计',
      system: '/api/system/configs - 系统配置'
    }
  });
});

app.use('/api/employees', employeesRouter);
app.use('/api/services', servicesRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/slots', slotsRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/waitlist', waitlistRouter);
app.use('/api/admin', adminRouter);
app.use('/api/system', systemRouter);
app.use('/api/customers', customersRouter);

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    code: err.code || 500,
    message: err.message || '服务器内部错误'
  });
});

app.use((req, res) => {
  res.status(404).json({
    code: 404,
    message: `接口不存在: ${req.method} ${req.url}`
  });
});

app.listen(PORT, () => {
  console.log('\n========================================');
  console.log('  理发店预约排班服务 已启动');
  console.log(`  端口: ${PORT}`);
  console.log(`  地址: http://localhost:${PORT}`);
  console.log(`  今日日期: ${getDateStr()}`);
  console.log('========================================\n');
  console.log('快速测试链接:');
  console.log(`  首页:          http://localhost:${PORT}/`);
  console.log(`  员工列表:      http://localhost:${PORT}/api/employees`);
  console.log(`  服务项目:      http://localhost:${PORT}/api/services`);
  console.log(`  今日排班:      http://localhost:${PORT}/api/schedules?start_date=${getDateStr()}&end_date=${getDateStr()}`);
  console.log(`  发型师空档:    http://localhost:${PORT}/api/slots/employee/1?date=${getDateStr()}`);
  console.log(`  项目可约时段:  http://localhost:${PORT}/api/slots/service/1?date=${getDateStr()}`);
  console.log(`  今日预约:      http://localhost:${PORT}/api/bookings?booking_date=${getDateStr()}`);
  console.log(`  管理端统计:    http://localhost:${PORT}/api/admin/dashboard/${getDateStr()}`);
  console.log(`  候补名单:      http://localhost:${PORT}/api/waitlist`);
  console.log('');
});
