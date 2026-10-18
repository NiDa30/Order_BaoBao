import {mock,login} from './helpers/cloud.js';
import {test,expect} from '@playwright/test';
const nav=(page,name)=>page.getByRole('button',{name,exact:true}).filter({visible:true}).first();
async function newOrder(page){await page.getByRole('button',{name:'＋ Tạo đơn mới',exact:true}).click();}
async function addCoffee(page){await page.getByRole('button',{name:/Cà phê Cà phê sữa/}).click();}
test.beforeEach(async({page,context},info)=>{const server={workspace:null};await mock(context,server);if(/shift close|after closing/.test(info.title)){server.workspace={revision:0,data:{menu:[{id:'coffee',name:'Cà phê sữa',category:'Cà phê',price:22000}],orders:[],closings:[]}};server.access.role='staff';const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());server.access.assignments=[1,2,3].map(shift=>({day,shift,user_id:server.access.userId}));}await login(page);});
test('order, quantities, payment, persistence and shift close',async({page})=>{
 await newOrder(page);await addCoffee(page);await page.getByRole('button',{name:'Tăng Cà phê sữa'}).click();
 await expect(page.locator('#cart-total')).toContainText('44.000');await page.getByRole('button',{name:'15',exact:true}).click();await page.locator('#customer-input').fill('Chị Linh');
 await page.getByRole('button',{name:'Lưu đơn hàng'}).click();await expect(page.locator('.order-card')).toContainText('Chị Linh');await page.reload();await expect(page.locator('.order-card')).toContainText('44.000');
 await page.getByRole('button',{name:'◴ Mở / đóng ca',exact:true}).click();await page.getByRole('button',{name:'Kết ca 1 ↗'}).click();await expect(page.locator('.warning')).toContainText('1 đơn chưa thanh toán');
 await page.getByRole('button',{name:'Xem đơn chưa thanh toán'}).click();await page.locator('.order-card').click();await page.getByRole('button',{name:'✓ Xác nhận đã thanh toán'}).click();await expect(page.locator('.stat').first()).toContainText('44.000');
 await page.getByRole('button',{name:'◴ Mở / đóng ca',exact:true}).click();await page.getByRole('button',{name:'Kết ca 1 ↗'}).click();await page.getByRole('button',{name:'Xác nhận kết ca'}).click();await expect(page.locator('.shift-card').first()).toContainText('Đã kết ca');await page.reload();await page.getByRole('button',{name:'◴ Mở / đóng ca',exact:true}).click();await expect(page.locator('.shift-card').first()).toContainText('44.000');
});
test('search, custom menu item, custom order label and history',async({page})=>{
 await newOrder(page);await page.getByLabel('Tìm món cho đơn').fill('Mon moi');await expect(page.locator('.mini-empty')).toBeVisible();await page.getByRole('button',{name:'＋ Thêm món & giá'}).click();await page.locator('[name=name]').fill('Trà đặc biệt');await page.locator('[name=price]').fill('42000');await page.getByRole('button',{name:'Thêm vào thực đơn',exact:true}).click();
 await page.getByLabel('Tìm món cho đơn').fill('tra dac biet');await page.locator('[data-add]').click();await page.locator('#table-input').fill('Mang về A');await page.locator('#note-input').fill('Ít đá');await page.getByRole('button',{name:'Lưu đơn hàng'}).click();
 await page.locator('[data-page=history]:visible').click();await page.getByLabel('Tìm đơn hàng', {exact:true}).fill('mang ve');await expect(page.locator('.history-row')).toHaveCount(1);await page.locator('.history-row').click();await expect(page.locator('.small-dialog')).toContainText('Ít đá');await expect(page.locator('.small-dialog')).toContainText('42.000');await page.getByRole('button',{name:'Đóng',exact:true}).click();await page.reload();await expect(page.locator('.order-card')).toHaveCount(1);
});
test('three shifts, validation and responsive bounds',async({page})=>{
 await newOrder(page);await page.getByRole('button',{name:'Lưu đơn hàng'}).click();await expect(page.getByRole('status')).toContainText('ít nhất một món');await addCoffee(page);await page.getByRole('button',{name:'Giảm Cà phê sữa'}).click();await expect(page.locator('.cart-empty')).toBeVisible();await page.getByRole('button',{name:'Đóng',exact:true}).click();
 await page.getByRole('button',{name:'Ca 2',exact:true}).click();await newOrder(page);await addCoffee(page);await page.getByRole('button',{name:'Lưu đơn hàng'}).click();await expect(page.locator('.order-card')).toHaveCount(1);await page.getByRole('button',{name:'Ca 1',exact:true}).click();await expect(page.locator('.order-card')).toHaveCount(0);await page.getByRole('button',{name:'Ca 3',exact:true}).click();await expect(page.locator('.order-card')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.screenshot({path:`test-results/dashboard-${test.info().project.name}.png`,fullPage:true});
});

test('edit from history updates existing order and persists without duplicating',async({page})=>{
 await newOrder(page);await addCoffee(page);await page.getByRole('button',{name:'Lưu đơn hàng',exact:false}).click();
 const before=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('lam-an-cloud-v2:')&&!k.includes(':backup:')))).local.orders[0]);
 await page.locator('[data-page=history]:visible').click();await page.locator('.history-row').click();await page.getByRole('button',{name:'✎ Sửa đơn',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Sửa đơn hàng',exact:true})).toBeVisible();await page.locator('#table-input').fill('Mang về 20');await page.locator('#customer-input').fill('Anh Nam');await page.locator('#note-input').fill('Sửa lại: ít đường');
 await page.getByRole('button',{name:'Tăng Cà phê sữa',exact:true}).click();await page.getByLabel('Đơn giá Cà phê sữa',{exact:true}).fill('23000');await page.getByLabel('Tìm món cho đơn').fill('nuoc suoi');await page.locator('[data-add]').click();
 await expect(page.locator('#cart-total')).toContainText('61.000');await page.getByRole('button',{name:'Lưu thay đổi',exact:false}).click();await expect(page.locator('.small-dialog')).toContainText('Anh Nam');await expect(page.locator('.small-dialog')).toContainText('61.000');
 await page.reload();await expect(page.locator('.order-card')).toHaveCount(1);await expect(page.locator('.order-card')).toContainText('Anh Nam');
 const db=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('lam-an-cloud-v2:')&&!k.includes(':backup:')))).local);const after=db.orders[0];expect(after.id).toBe(before.id);expect(after.code).toBe(before.code);expect(after.created).toBe(before.created);expect(after.day).toBe(before.day);expect(after.shift).toBe(before.shift);expect(after.status).toBe('open');expect(after.table).toBe('Mang về 20');expect(after.revisions).toHaveLength(1);expect(after.revisions[0].before.items[0].qty).toBe(1);expect(db.menu.find(m=>m.id==='m1').price).toBe(22000);
});

test('editing a paid order after closing reconciles revenue and retains payment metadata',async({page})=>{
 await newOrder(page);await addCoffee(page);await page.getByRole('button',{name:'Lưu đơn hàng',exact:false}).click();await page.locator('.order-card').click();await page.getByRole('button',{name:'✓ Xác nhận đã thanh toán'}).click();
 await page.getByRole('button',{name:'◴ Mở / đóng ca',exact:true}).click();await page.getByRole('button',{name:'Kết ca 1 ↗'}).click();await page.getByRole('button',{name:'Xác nhận kết ca'}).click();
 const before=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('lam-an-cloud-v2:')&&!k.includes(':backup:')))).local);
 await page.locator('[data-page=history]:visible').click();await page.locator('.history-row').click();await page.getByRole('button',{name:'✎ Sửa đơn',exact:true}).click();await page.getByRole('button',{name:'Tăng Cà phê sữa',exact:true}).click();await page.locator('#edit-reason').fill('Khách gọi thêm món');await page.locator('#settlement-confirmed').check();await page.getByRole('button',{name:'Lưu thay đổi',exact:false}).click();
 await expect(page.locator('.small-dialog')).toContainText('Đã thanh toán');await expect(page.locator('.small-dialog')).toContainText('44.000');await page.getByRole('button',{name:'Đóng',exact:true}).click();await expect(page.locator('.history-row')).toContainText('44.000');
 await page.locator('[data-page=shifts]:visible').click();await expect(page.locator('.daily-total')).toContainText('44.000');await expect(page.locator('.closing-row')).toContainText('Đã điều chỉnh từ 22.000');await page.reload();
 const after=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('lam-an-cloud-v2:')&&!k.includes(':backup:')))).local);expect(after.orders).toHaveLength(1);expect(after.orders[0].paidAt).toBe(before.orders[0].paidAt);expect(after.orders[0].status).toBe('paid');expect(after.closings[0].at).toBe(before.closings[0].at);expect(after.closings[0].originalRevenue).toBe(22000);expect(after.closings[0].revenue).toBe(44000);expect(after.closings[0].count).toBe(1);
});

test('cancel and invalid edits preserve saved order',async({page})=>{
 await newOrder(page);await addCoffee(page);await page.getByRole('button',{name:'Lưu đơn hàng',exact:false}).click();await page.locator('[data-page=history]:visible').click();await page.locator('.history-row').click();await page.getByRole('button',{name:'✎ Sửa đơn',exact:true}).click();
 await page.getByLabel('Đơn giá Cà phê sữa',{exact:true}).fill('0');await page.getByRole('button',{name:'Lưu thay đổi',exact:false}).click();await expect(page.getByRole('status')).toContainText('Đơn giá phải');await page.getByRole('button',{name:'Giảm Cà phê sữa',exact:true}).click();await page.getByRole('button',{name:'Lưu thay đổi',exact:false}).click();await expect(page.getByRole('status')).toContainText('ít nhất một món');await page.getByRole('button',{name:'Đóng',exact:true}).click();
 await expect(page.locator('.small-dialog')).toContainText('22.000');await page.getByRole('button',{name:'✎ Sửa đơn',exact:true}).click();await page.locator('#customer-input').fill('Không lưu');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Đóng',exact:true}).click();await expect(page.locator('.small-dialog')).not.toContainText('Không lưu');
 const order=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('lam-an-cloud-v2:')&&!k.includes(':backup:')))).local.orders[0]);expect(order.customer).toBe('');expect(order.revisions).toBeUndefined();expect(order.items[0].price).toBe(22000);expect(order.items[0].qty).toBe(1);
});

test('cash payment is selected explicitly and persisted in history',async({page})=>{
 await newOrder(page);await addCoffee(page);await page.getByRole('button',{name:'Lưu đơn hàng',exact:false}).click();await page.locator('.order-card').click();
 await expect(page.getByRole('button',{name:/Tiền mặt/})).toHaveAttribute('aria-pressed','true');await expect(page.locator('.payment-qr')).toHaveCount(0);await page.getByRole('button',{name:'✓ Xác nhận đã thanh toán'}).click();
 await page.reload();await page.locator('[data-page=history]:visible').click();await expect(page.locator('.history-row')).toContainText('Tiền mặt');await page.locator('.history-row').click();await expect(page.locator('.payment-receipt')).toContainText('Tiền mặt');
 const order=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('lam-an-cloud-v2:')&&!k.includes(':backup:')))).local.orders[0]);expect(order.paymentMethod).toBe('cash');expect(order.status).toBe('paid');expect(order.paidAt).toBeTruthy();
});

test('transfer QR is a demo and payment requires manual confirmation',async({page})=>{
 await newOrder(page);await addCoffee(page);await page.getByRole('button',{name:'Lưu đơn hàng',exact:false}).click();await page.locator('.order-card').click();await page.getByRole('button',{name:/Chuyển khoản/}).click();
 await expect(page.locator('.transfer-panel')).toContainText('QR MẪU');await expect(page.locator('.transfer-panel')).toContainText('22.000');await expect(page.locator('.transfer-panel')).toContainText('LAM AN');await page.locator('.payment-qr').evaluate(img=>img.decode());
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('lam-an-cloud-v2:')&&!k.includes(':backup:')))).local.orders[0].status)).toBe('open');await page.getByRole('button',{name:'Đóng',exact:true}).click();await page.reload();await expect(page.locator('.order-card')).toContainText('Đang phục vụ');await page.locator('.order-card').click();await page.getByRole('button',{name:/Chuyển khoản/}).click();await page.getByRole('button',{name:'✓ Xác nhận đã thanh toán'}).click();
 await page.reload();await page.locator('[data-page=history]:visible').click();await expect(page.locator('.history-row')).toContainText('Chuyển khoản');await page.locator('.history-row').click();await expect(page.locator('.payment-receipt')).toContainText('Chuyển khoản');
 const order=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('lam-an-cloud-v2:')&&!k.includes(':backup:')))).local.orders[0]);expect(order.paymentMethod).toBe('transfer');expect(order.status).toBe('paid');
 await page.getByRole('button',{name:'✎ Sửa đơn',exact:true}).click();await page.getByRole('button',{name:'Tăng Cà phê sữa',exact:true}).click();await page.locator('#edit-reason').fill('Khách gọi thêm món');await page.locator('#settlement-confirmed').check();await page.getByRole('button',{name:'Lưu thay đổi',exact:false}).click();await expect(page.locator('.payment-receipt')).toContainText('Chuyển khoản');
});
