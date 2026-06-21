console.log('开始语法检查...');
const modules = [
  '../utils/timeUtils',
  '../utils/bookingValidator',
  '../utils/smsGenerator',
  '../utils/slotCalculator',
  '../db/index'
];
for (const m of modules) {
  try {
    require(m);
    console.log('  ✓', m);
  } catch (e) {
    console.log('  ✗', m, ':', e.message);
  }
}
console.log('语法检查完成');
