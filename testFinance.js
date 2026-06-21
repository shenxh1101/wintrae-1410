const http = require('http');

const req = (method, path, data = null) => new Promise((resolve) => {
  const postData = data ? JSON.stringify(data) : null;
  const options = {
    hostname: 'localhost',
    port: 3000,
    path,
    method,
    headers: postData ? {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    } : {}
  };
  const r = http.request(options, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => {
      try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
      catch (e) { resolve({ status: res.statusCode, body }); }
    });
  });
  r.on('error', (e) => resolve({ status: 0, body: { error: e.message } }));
  if (postData) r.write(postData);
  r.end();
});

const log = (label, val, extra = null) => {
  const tag = label.padEnd(40, ' ');
  if (extra !== null) {
    console.log(`✅ ${tag} ${val}  (${extra})`);
  } else {
    console.log(`✅ ${tag} ${val}`);
  }
};
const fail = (label, val) => console.log(`❌ ${label.padEnd(38, ' ')} ${val}`);

async function main() {
  const today = '2026-06-22';
  const testDate = '2026-06-22';
  const phone = '138' + String(Math.floor(Math.random() * 90000000) + 10000000);

  console.log('\n==== 准备数据 ====\n');

  const svc1 = await req('POST', '/api/services', {
    name: '剪发(测试A)', duration_minutes: 30, price: 88, is_active: 1
  });
  log('创建主服务(剪发)', `ID=${svc1.body.data.id}, ¥${svc1.body.data.price}`);

  const svc2 = await req('POST', '/api/services', {
    name: '护理(测试B)', duration_minutes: 45, price: 168, is_active: 0
  });
  log('创建停用服务(护理)', `ID=${svc2.body.data.id}, is_active=0`);

  const svc3 = await req('POST', '/api/services', {
    name: '染发(测试C)', duration_minutes: 90, price: 388, is_active: 1, deposit: 50
  });
  log('创建染发(有订金)', `ID=${svc3.body.data.id}, ¥${svc3.body.data.price}, 订金¥50`);

  console.log('\n==== 1. 服务批量查询(夹停用+不存在) ====\n');

  const batch = await req('GET', `/api/services/batch/query?ids=${svc1.body.data.id},${svc2.body.data.id},9999,${svc3.body.data.id}`);
  console.log('真实返回:');
  console.log('  requested_ids =', batch.body.requested_ids);
  console.log('  found_count   =', batch.body.found_count);
  console.log('  data          =', batch.body.data.map(s => `#${s.id} ${s.name} ¥${s.price} active=${s.is_active}`));
  console.log('  not_found     =', JSON.stringify(batch.body.not_found));
  console.log('  inactive      =', JSON.stringify(batch.body.inactive));
  if (batch.body.not_found.length === 1
      && batch.body.not_found[0].id === 9999
      && batch.body.inactive.length === 1
      && batch.body.inactive[0].id === svc2.body.data.id
      && batch.body.found_count === 3) {
    log('批量查询(正常+停用+不存在)', '通过', '返回清楚');
  } else {
    fail('批量查询', '返回字段不完整');
  }

  console.log('\n==== 2. 会员 + 储值 + 次卡 准备 ====\n');
  await req('POST', '/api/members', { phone, name: '测试顾客', level: '普通' });
  log('创建会员', phone);

  const r = await req('POST', '/api/members/recharge', { phone, amount: 200 });
  log('会员充值¥200', `新余额¥${r.body.data.stored_value}`);

  const cardR = await req('POST', '/api/members/cards/purchase', {
    phone, service_id: svc1.body.data.id, total_count: 1, paid_amount: 66
  });
  log('购买剪发次卡 1 次', `card_id=${cardR.body.data.id}, 剩${cardR.body.data.remaining_count}次`);

  console.log('\n==== 3. 创建预约 + 标记到店 ====\n');
  const bookingR = await req('POST', '/api/bookings', {
    customer_name: '测试顾客',
    customer_phone: phone,
    employee_id: 1,
    service_id: svc1.body.data.id,
    addon_service_ids: `${svc3.body.data.id}`,
    booking_date: testDate,
    start_time: '11:00',
    channel: 'offline',
    note: '异常测试预约'
  });
  if (bookingR.body.code !== 0) {
    console.log('预约失败:', bookingR.body);
    process.exit(1);
  }
  const bid = bookingR.body.data.id;
  log('创建预约', `booking_id=${bid}, ¥${bookingR.body.data.service_price} + 染发¥${svc3.body.data.price}`);

  await req('POST', `/api/bookings/${bid}/arrive`);
  log('标记到店', 'status=arrived');

  console.log('\n==== 4. 异常测试：优惠超过应付 ====\n');

  const beforeMember = await req('GET', `/api/members/${phone}`);
  const beforeCards = await req('GET', `/api/members/${phone}/cards`);
  const remainBefore = beforeCards.body.data.reduce((s, c) => s + (c.remaining_count || 0), 0);
  log('扣款前状态', `储值¥${beforeMember.body.data.stored_value}, 次卡剩${remainBefore}次`);

  const overDiscount = await req('POST', `/api/transactions/${bid}/checkout`, {
    discount_amount: 99999,
    use_deposit: false,
    payment_method: 'cash'
  });
  if (overDiscount.status === 400 && /优惠金额.*不能超过应付/.test(overDiscount.body.message)) {
    log('优惠超应付被拒', '正确拒绝');
  } else {
    fail('优惠超应付被拒', `未被正确拒绝 status=${overDiscount.status} msg=${JSON.stringify(overDiscount.body)}`);
  }

  const mem1 = await req('GET', `/api/members/${phone}`);
  const cards1 = await req('GET', `/api/members/${phone}/cards`);
  const rem1 = cards1.body.data.reduce((s, c) => s + (c.remaining_count || 0), 0);
  if (mem1.body.data.stored_value === beforeMember.body.data.stored_value && rem1 === remainBefore) {
    log('回滚验证(余额/次数)', `不变 余额¥${mem1.body.data.stored_value}, 次卡${rem1}次`);
  } else {
    fail('回滚验证', `余额/次数变动了！余额¥${mem1.body.data.stored_value}, 次卡${rem1}次`);
  }

  console.log('\n==== 5. 异常测试：储值不足 ====\n');

  const notEnoughSv = await req('POST', `/api/transactions/${bid}/checkout`, {
    discount_amount: 0,
    use_deposit: false,
    use_stored_value: 9999,
    payment_method: 'stored_value'
  });
  if (notEnoughSv.status === 400 && /储值余额不足/.test(notEnoughSv.body.message)) {
    log('储值不足被拒', '正确拒绝');
  } else {
    fail('储值不足被拒', `未被正确拒绝 status=${notEnoughSv.status} msg=${JSON.stringify(notEnoughSv.body)}`);
  }

  const mem2 = await req('GET', `/api/members/${phone}`);
  const cards2 = await req('GET', `/api/members/${phone}/cards`);
  const rem2 = cards2.body.data.reduce((s, c) => s + (c.remaining_count || 0), 0);
  if (mem2.body.data.stored_value === beforeMember.body.data.stored_value && rem2 === remainBefore) {
    log('回滚验证(余额/次数)', `不变 余额¥${mem2.body.data.stored_value}, 次卡${rem2}次`);
  } else {
    fail('回滚验证', `余额/次数变动了！余额¥${mem2.body.data.stored_value}, 次卡${rem2}次`);
  }

  console.log('\n==== 6. 异常测试：次卡次数不足 ====\n');

  const notEnoughCard = await req('POST', `/api/transactions/${bid}/checkout`, {
    discount_amount: 0,
    use_deposit: false,
    use_service_cards: [{ service_id: svc3.body.data.id, count: 1 }],
    payment_method: 'cash'
  });
  if (notEnoughCard.status === 400 && /剩余次数不足|次卡.*不足/.test(notEnoughCard.body.message)) {
    log('次卡次数不足被拒', '正确拒绝');
  } else {
    fail('次卡次数不足被拒', `未被正确拒绝 status=${notEnoughCard.status} msg=${JSON.stringify(notEnoughCard.body.message || notEnoughCard.body)}`);
  }

  const mem3 = await req('GET', `/api/members/${phone}`);
  const cards3 = await req('GET', `/api/members/${phone}/cards`);
  const rem3 = cards3.body.data.reduce((s, c) => s + (c.remaining_count || 0), 0);
  if (mem3.body.data.stored_value === beforeMember.body.data.stored_value && rem3 === remainBefore) {
    log('回滚验证(余额/次数)', `不变 余额¥${mem3.body.data.stored_value}, 次卡${rem3}次`);
  } else {
    fail('回滚验证', `余额/次数变动了！余额¥${mem3.body.data.stored_value}, 次卡${rem3}次`);
  }

  console.log('\n==== 7. 正常：混合支付(次卡+储值+优惠+现金) ====\n');

  // 主服务剪发¥88用次卡扣1次；加做染发¥388 - 优惠¥50 - 储值¥200 - 现金¥138
  const checkout = await req('POST', `/api/transactions/${bid}/checkout`, {
    discount_amount: 50,
    use_deposit: false,
    use_stored_value: 200,
    use_service_cards: [{ service_id: svc1.body.data.id, count: 1 }],
    payment_method: 'cash'
  });

  if (checkout.body.code === 0 && !checkout.body.is_duplicate) {
    const s = checkout.body.summary;
    const calc = s.service_total + s.addon_total - s.discount_amount - s.deposit_used - s.stored_value_used - (s.service_card_used_count > 0 ? s.service_total : 0);
    log('混合支付结账成功', `应付=¥${s.total_amount}, 优惠¥${s.discount_amount}, 储值扣¥${s.stored_value_used}, 次卡扣${s.service_card_used_count}次, 实收¥${s.actual_amount}`);
    const expected = 88 + 388 - 50 - 200 - 88;
    if (Math.abs(s.actual_amount - expected) < 0.01) {
      log('金额校验', `计算正确 实收¥${s.actual_amount} = 预期¥${expected}`);
    } else {
      fail('金额校验', `实收¥${s.actual_amount} 预期¥${expected}`);
    }
  } else {
    fail('混合支付结账成功', JSON.stringify(checkout.body));
  }

  const mem4 = await req('GET', `/api/members/${phone}`);
  const cards4 = await req('GET', `/api/members/${phone}/cards`);
  const rem4 = cards4.body.data.reduce((s, c) => s + (c.remaining_count || 0), 0);
  if (mem4.body.data.stored_value === 0 && rem4 === 0) {
    log('扣款后余额次数正确', `余额¥${mem4.body.data.stored_value}, 剩次卡${rem4}次`);
  } else {
    fail('扣款后不正确', `余额¥${mem4.body.data.stored_value}, 剩次卡${rem4}次`);
  }

  console.log('\n==== 8. 消费明细时间线 ====\n');
  const tl = await req('GET', `/api/members/${phone}/timeline`);
  console.log('  共', tl.body.data.total_records, '条记录');
  for (const rec of tl.body.data.timeline) {
    console.log(`    [${rec.type_label}] ${rec.date} 金额¥${rec.amount} ${rec.remark || ''} ${rec.booking ? '预约#' + rec.booking.booking_no : ''}`);
    if (rec.benefits_used && rec.benefits_used.length) {
      for (const b of rec.benefits_used) {
        console.log(`      ↳ 权益: ${b.label} ${b.amount ? '¥' + b.amount : ''}${b.count ? b.count + '次' : ''}`);
      }
    }
    if (rec.stylist) console.log(`      ↳ 发型师: ${rec.stylist.name}`);
  }
  log('时间线接口', `返回${tl.body.data.total_records}条记录`);

  console.log('\n==== 9. 日看板 finance 分离统计 ====\n');
  const dash = await req('GET', `/api/admin/dashboard/2026-06-21`);
  const fin = dash.body.data.summary.finance;
  console.log('  储值充值: ¥' + fin.recharge.total_amount + ' (' + fin.recharge.count + '笔)');
  console.log('  次卡售卖: ¥' + fin.card_purchase.total_amount + ' (' + fin.card_purchase.count + '笔)');
  console.log('  到店消费: ¥' + fin.consumption.total_amount + ' (' + fin.consumption.count + '笔)');
  console.log('  消费细分: 现金¥' + fin.consumption.cash_amount + ' 储值¥' + fin.consumption.stored_value_amount + ' 订金¥' + fin.consumption.deposit_amount + ' 次卡' + fin.consumption.service_card_count + '次');
  if (fin.recharge.total_amount >= 200 && fin.card_purchase.total_amount >= 66 && fin.consumption.total_amount >= 138) {
    log('日看板分离统计', '通过，各口径独立');
  } else {
    fail('日看板分离统计', '金额不正确 充值=' + fin.recharge.total_amount + ' 次卡=' + fin.card_purchase.total_amount + ' 消费=' + fin.consumption.total_amount);
  }

  console.log('\n==== 全部测试完成 ====\n');
}

main().catch(console.error);
