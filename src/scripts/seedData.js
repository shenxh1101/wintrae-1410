const dayjs = require('dayjs');
const db = require('../db');
const employeeDao = require('../daos/employeeDao');
const serviceDao = require('../daos/serviceDao');
const scheduleDao = require('../daos/scheduleDao');
const bookingDao = require('../daos/bookingDao');
const waitlistDao = require('../daos/waitlistDao');
const configDao = require('../daos/configDao');
const { calculateEndTime } = require('../utils/bookingValidator');

const seed = () => {
  db.load();

  db.transaction(() => {
    console.log('开始插入示例数据...');

    const stylist1 = employeeDao.create({ name: '张伟', role: 'stylist', phone: '13800000001', station_number: 1 });
    const stylist2 = employeeDao.create({ name: '李娜', role: 'stylist', phone: '13800000002', station_number: 2 });
    const stylist3 = employeeDao.create({ name: '王芳', role: 'stylist', phone: '13800000003', station_number: 3 });
    const assistant1 = employeeDao.create({ name: '刘洋', role: 'assistant', phone: '13800000004' });
    const assistant2 = employeeDao.create({ name: '陈静', role: 'assistant', phone: '13800000005' });
    const manager = employeeDao.create({ name: '赵磊', role: 'manager', phone: '13800000006' });
    console.log('员工数据插入完成');

    const svc1 = serviceDao.create({ name: '男士剪发', duration_minutes: 45, price: 88, category: '剪发', description: '专业男士造型设计' });
    const svc2 = serviceDao.create({ name: '女士剪发', duration_minutes: 60, price: 128, category: '剪发', description: '女士精剪+造型' });
    const svc3 = serviceDao.create({ name: '染发(基础)', duration_minutes: 120, price: 388, category: '染烫', description: '健康植物染' });
    const svc4 = serviceDao.create({ name: '烫发(基础)', duration_minutes: 150, price: 488, category: '染烫', description: '冷烫/热烫' });
    const svc5 = serviceDao.create({ name: '护理SPA', duration_minutes: 60, price: 198, category: '护理', description: '深层修复护理' });
    const svc6 = serviceDao.create({ name: '洗吹造型', duration_minutes: 30, price: 48, category: '造型', description: '洗发+吹卷/拉直' });
    const svc7 = serviceDao.create({ name: '挑染', duration_minutes: 90, price: 268, category: '染烫', description: '局部挑染' });
    const svc8 = serviceDao.create({ name: '刘海修剪', duration_minutes: 15, price: 28, category: '剪发', description: '精修刘海' });
    console.log('服务项目数据插入完成');

    const today = dayjs();
    const stylists = [stylist1, stylist2, stylist3];
    const assistants = [assistant1, assistant2];

    for (let i = 0; i < 7; i++) {
      const date = today.add(i, 'day').format('YYYY-MM-DD');
      const dayOfWeek = today.add(i, 'day').day();

      stylists.forEach((stylist, idx) => {
        const isDayOff = (i === 2 && idx === 0) || (i === 4 && idx === 1);
        const startShift = idx === 0 ? '09:00' : (idx === 1 ? '10:00' : '11:00');
        const endShift = idx === 0 ? '18:00' : (idx === 1 ? '19:00' : '21:00');

        scheduleDao.upsert({
          employee_id: stylist.id,
          schedule_date: date,
          start_time: isDayOff ? '00:00' : startShift,
          end_time: isDayOff ? '00:00' : endShift,
          is_day_off: isDayOff ? 1 : 0,
          break_start: isDayOff ? null : '13:00',
          break_end: isDayOff ? null : '14:00',
          note: isDayOff ? '休息日' : null
        });
      });

      if (dayOfWeek !== 0) {
        assistants.forEach((asst, idx) => {
          scheduleDao.upsert({
            employee_id: asst.id,
            schedule_date: date,
            start_time: idx === 0 ? '09:00' : '12:00',
            end_time: idx === 0 ? '18:00' : '21:00',
            is_day_off: 0,
            break_start: idx === 0 ? '14:00' : '17:00',
            break_end: idx === 0 ? '15:00' : '18:00'
          });
        });
      }
    }
    console.log('排班数据插入完成(未来7天)');

    const bookingSamples = [
      { customer: '张三', phone: '13900001001', stylistIdx: 0, svc: svc1, dateOffset: 0, time: '10:00', assistantIdx: 0, status: 'confirmed', source: 'frontdesk', hairNote: '油性发质' },
      { customer: '王美丽', phone: '13900001002', stylistIdx: 1, svc: svc2, dateOffset: 0, time: '10:30', assistantIdx: 1, status: 'pending', source: 'online' },
      { customer: '李小明', phone: '13900001003', stylistIdx: 0, svc: svc6, dateOffset: 0, time: '14:30', assistantIdx: 0, status: 'arrived', source: 'frontdesk' },
      { customer: '陈思思', phone: '13900001004', stylistIdx: 2, svc: svc3, dateOffset: 0, time: '14:00', assistantIdx: 1, status: 'confirmed', source: 'online', hairNote: '干性受损发质', remark: '不要太黄' },
      { customer: '赵强', phone: '13900001005', stylistIdx: 1, svc: svc1, dateOffset: 0, time: '15:00', assistantIdx: 0, status: 'completed', source: 'frontdesk' },
      { customer: '孙丽', phone: '13900001006', stylistIdx: 0, svc: svc5, dateOffset: 1, time: '10:00', assistantIdx: 1, status: 'pending', source: 'online', remark: '加做肩颈按摩' },
      { customer: '周杰', phone: '13900001007', stylistIdx: 2, svc: svc4, dateOffset: 1, time: '13:00', assistantIdx: 0, status: 'confirmed', source: 'online', hairNote: '细软发质' },
      { customer: '吴敏', phone: '13900001008', stylistIdx: 1, svc: svc2, dateOffset: 1, time: '16:00', assistantIdx: 1, status: 'confirmed', source: 'frontdesk' },
      { customer: '郑磊', phone: '13900001009', stylistIdx: 0, svc: svc1, dateOffset: 2, time: '10:00', assistantIdx: 0, status: 'pending', source: 'online' },
      { customer: '钱婷', phone: '13900001010', stylistIdx: 2, svc: svc3, dateOffset: 3, time: '11:00', assistantIdx: 1, status: 'pending', source: 'online', addons: [svc7.id], hairNote: '自然黑', remark: '棕色调挑染' },
      { customer: '冯超', phone: '13900001011', stylistIdx: 0, svc: svc1, dateOffset: 0, time: '16:30', assistantIdx: null, status: 'no_show', source: 'online' }
    ];

    for (const sample of bookingSamples) {
      const date = today.add(sample.dateOffset, 'day').format('YYYY-MM-DD');
      const addonIds = sample.addons || [];
      const endTime = calculateEndTime(sample.time, sample.svc.id, addonIds);

      bookingDao.create({
        customer_name: sample.customer,
        customer_phone: sample.phone,
        employee_id: stylists[sample.stylistIdx].id,
        assistant_id: sample.assistantIdx !== null ? assistants[sample.assistantIdx].id : null,
        service_id: sample.svc.id,
        addon_service_ids: addonIds.length ? addonIds.join(',') : null,
        booking_date: date,
        start_time: sample.time,
        end_time: endTime,
        hair_note: sample.hairNote,
        remark: sample.remark,
        status: sample.status,
        source: sample.source
      });
    }
    console.log('预约数据插入完成');

    waitlistDao.create({
      customer_name: '候补王',
      customer_phone: '13900009999',
      employee_id: stylist1.id,
      service_id: svc2.id,
      preferred_date: today.format('YYYY-MM-DD'),
      preferred_times: '14:00,15:00,16:00',
      hair_note: '敏感性头皮',
      remark: '希望今天能排上'
    });
    waitlistDao.create({
      customer_name: '候补李',
      customer_phone: '13900009998',
      employee_id: stylist2.id,
      service_id: svc3.id,
      preferred_date: today.add(1, 'day').format('YYYY-MM-DD'),
      status: 'waiting'
    });
    console.log('候补名单数据插入完成');

    configDao.initDefaultConfigs();
    console.log('系统配置初始化完成');

    console.log('示例数据全部插入成功!');
  });
};

seed();
