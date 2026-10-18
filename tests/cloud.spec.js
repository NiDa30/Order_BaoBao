import {test,expect} from '@playwright/test';
const endpoint='https://test-project.supabase.co';
const user={id:'11111111-1111-4111-8111-111111111111',email:'pos@example.test',aud:'authenticated',role:'authenticated',created_at:'2026-01-01T00:00:00Z',app_metadata:{},user_metadata:{}};
const jwt=()=>`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:user.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.test-signature`;
async function mock(context,server){
 await context.route(`${endpoint}/**`,async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS','content-type':'application/json'};
  const reply=(body,status=200)=>route.fulfill({status,headers,body:JSON.stringify(body)});
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(path==='/auth/v1/token')return reply({access_token:jwt(),refresh_token:'test-refresh',token_type:'bearer',expires_in:3600,user});
  if(path==='/auth/v1/logout')return reply({});
  if(path==='/auth/v1/user')return reply(user);
  if(server.offline)return route.abort('internetdisconnected');
  if(path==='/rest/v1/rpc/pos_read_workspace')return reply(server.workspace);
  if(path==='/rest/v1/rpc/pos_save_workspace'){
   const body=request.postDataJSON();
   if(body.expected_revision!==(server.workspace?.revision||0))return reply({code:'40001',message:'Conflict'},409);
   server.workspace={revision:(server.workspace?.revision||0)+1,data:structuredClone(body.next_data)};
   return reply(server.workspace);
  }
  return reply({message:'Unexpected test request'},404);
 });
}
async function login(page){
 await page.goto('/');await page.locator('.topbar [data-action=cloud]').click();await page.locator('#cloud-login [name=email]').fill(user.email);await page.locator('#cloud-login [name=password]').fill('synthetic-test-password');await page.getByRole('button',{name:'Đăng nhập & đồng bộ',exact:true}).click();await expect(page.locator('.cloud-summary')).toContainText('Đã đồng bộ');await page.getByRole('button',{name:'Đóng',exact:true}).click();
}
async function createOrder(page){
 await page.getByRole('button',{name:'＋ Tạo đơn mới',exact:true}).click();await page.getByRole('button',{name:/Cà phê Cà phê sữa/}).click();await page.getByRole('button',{name:'Lưu đơn hàng',exact:false}).click();await expect(page.locator('.topbar [data-cloud-label]')).toHaveText('Đã đồng bộ');
}
test('Supabase contract: writes round trip to a second device, including payment and closing',async({page,context,browser})=>{
 const server={workspace:null};await mock(context,server);await login(page);await createOrder(page);
 expect(server.workspace.data.orders).toHaveLength(1);await page.locator('.order-card').click();await page.getByRole('button',{name:/Chuyển khoản/}).click();await page.getByRole('button',{name:'✓ Xác nhận đã thanh toán'}).click();await expect(page.locator('.topbar [data-cloud-label]')).toHaveText('Đã đồng bộ');expect(server.workspace.data.orders[0].paymentMethod).toBe('transfer');
 await page.getByRole('button',{name:'◴ Kết ca',exact:true}).click();await page.getByRole('button',{name:'Kết ca 1 ↗'}).click();await page.getByRole('button',{name:'Xác nhận kết ca'}).click();await expect(page.locator('.topbar [data-cloud-label]')).toHaveText('Đã đồng bộ');expect(server.workspace.data.closings[0].revenue).toBe(22000);
 const other=await browser.newContext();await mock(other,server);const second=await other.newPage();await login(second);await expect(second.locator('.order-card')).toHaveCount(1);await expect(second.locator('.order-card')).toContainText('Đã thanh toán');await expect(second.locator('.stat').first()).toContainText('22.000');await other.close();
});
test('failed network keeps local changes across reload and retries without duplicates',async({page,context})=>{
 const server={workspace:null,offline:false};await mock(context,server);await login(page);server.offline=true;
 await page.getByRole('button',{name:'＋ Tạo đơn mới',exact:true}).click();await page.getByRole('button',{name:/Cà phê Cà phê sữa/}).click();await page.getByRole('button',{name:'Lưu đơn hàng',exact:false}).click();await expect(page.locator('.topbar [data-cloud-label]')).toHaveText('Chưa đồng bộ');expect(server.workspace.data.orders).toHaveLength(0);
 await page.reload();await expect(page.locator('.order-card')).toHaveCount(1);await expect(page.locator('.topbar [data-cloud-label]')).toHaveText('Chưa đồng bộ');server.offline=false;await page.locator('.topbar [data-action=cloud]').click();await page.getByRole('button',{name:'↻ Đồng bộ ngay',exact:true}).click();await expect(page.locator('.cloud-summary')).toContainText('Đã đồng bộ');expect(server.workspace.data.orders).toHaveLength(1);await page.getByRole('button',{name:'↻ Đồng bộ ngay',exact:true}).click();await expect(page.locator('.cloud-summary')).toContainText('Đã đồng bộ');expect(server.workspace.data.orders).toHaveLength(1);
});
test('concurrent edits surface conflict and keep both versions until explicit choice',async({page,context})=>{
 const server={workspace:null};await mock(context,server);await login(page);await createOrder(page);
 server.workspace.data.orders[0].note='Ghi chú từ máy khác';server.workspace.revision++;
 await page.locator('.order-card').click();await page.getByRole('button',{name:'✎ Sửa đơn',exact:true}).click();await page.locator('#customer-input').fill('Khách sửa trên máy');await page.getByRole('button',{name:'Lưu thay đổi',exact:false}).click();await expect(page.locator('.topbar [data-cloud-label]')).toHaveText('Cần đối chiếu');expect(server.workspace.data.orders[0].customer).toBe('');await expect(page.locator('.small-dialog')).toContainText('Khách sửa trên máy');
 await page.getByRole('button',{name:'Đóng',exact:true}).click();await page.locator('.topbar [data-action=cloud]').click();await expect(page.locator('.cloud-summary')).toContainText('hai thiết bị');page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Dùng bản trên database',exact:true}).click();await expect(page.locator('.cloud-summary')).toContainText('Đã đồng bộ');expect(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.includes(':backup:')))).toBe(true);
 await page.getByRole('button',{name:'Đóng',exact:true}).click();await page.locator('.order-card').click();await expect(page.locator('.small-dialog')).toContainText('Ghi chú từ máy khác');
});
test('legacy local sales stay separate and import requires explicit action',async({page,context})=>{
 const server={workspace:null};await mock(context,server);await page.goto('/');await page.getByRole('button',{name:'＋ Tạo đơn mới',exact:true}).click();await page.getByRole('button',{name:/Cà phê Cà phê sữa/}).click();await page.getByRole('button',{name:'Lưu đơn hàng',exact:false}).click();await login(page);await expect(page.locator('.order-card')).toHaveCount(0);expect(server.workspace.data.orders).toHaveLength(0);
 await page.locator('.topbar [data-action=cloud]').click();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Nhập dữ liệu cũ vào tài khoản',exact:true}).click();await expect(page.locator('.cloud-summary')).toContainText('Đã đồng bộ');expect(server.workspace.data.orders).toHaveLength(1);expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('lam-an-pos-v1')).orders.length)).toBe(1);
});
