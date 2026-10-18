import {test,expect} from '@playwright/test';
const nav=(page,name)=>page.getByRole('button',{name,exact:true}).filter({visible:true}).first();
async function newOrder(page){await page.getByRole('button',{name:'＋ Tạo đơn mới',exact:true}).click();}
async function addCoffee(page){await page.getByRole('button',{name:/Cà phê Cà phê sữa/}).click();}
test.beforeEach(async({page})=>{await page.goto('/');});
test('order, quantities, payment, persistence and shift close',async({page})=>{
 await newOrder(page);await addCoffee(page);await page.getByRole('button',{name:'Tăng Cà phê sữa'}).click();
 await expect(page.locator('#cart-total')).toContainText('44.000');await page.getByRole('button',{name:'15',exact:true}).click();await page.locator('#customer-input').fill('Chị Linh');
 await page.getByRole('button',{name:'Lưu đơn hàng'}).click();await expect(page.locator('.order-card')).toContainText('Chị Linh');await page.reload();await expect(page.locator('.order-card')).toContainText('44.000');
 await page.getByRole('button',{name:'◴ Kết ca',exact:true}).click();await page.getByRole('button',{name:'Kết ca 1 ↗'}).click();await expect(page.locator('.warning')).toContainText('1 đơn chưa thanh toán');
 await page.getByRole('button',{name:'Xem đơn chưa thanh toán'}).click();await page.locator('.order-card').click();await page.getByRole('button',{name:'✓ Xác nhận đã thanh toán'}).click();await expect(page.locator('.stat').first()).toContainText('44.000');
 await page.getByRole('button',{name:'◴ Kết ca',exact:true}).click();await page.getByRole('button',{name:'Kết ca 1 ↗'}).click();await page.getByRole('button',{name:'Xác nhận kết ca'}).click();await expect(page.locator('.shift-card').first()).toContainText('Đã kết ca');await page.reload();await page.getByRole('button',{name:'◴ Kết ca',exact:true}).click();await expect(page.locator('.shift-card').first()).toContainText('44.000');
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
