import {expect} from '@playwright/test';
const endpoint='https://test-project.supabase.co';
const user={id:'11111111-1111-4111-8111-111111111111',email:'pos@example.test',aud:'authenticated',role:'authenticated',created_at:'2026-01-01T00:00:00Z',app_metadata:{},user_metadata:{}};
const jwt=()=>`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:user.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.test-signature`;
export async function mock(context,server){
 await context.route(`${endpoint}/**`,async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS','content-type':'application/json'};
  const reply=(body,status=200)=>route.fulfill({status,headers,body:JSON.stringify(body)});
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(path==='/auth/v1/token'&&server.loginError)return reply({code:'invalid_credentials',message:'Invalid login credentials'},400);
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
export async function login(page){
 await page.goto('/');await page.locator('#cloud-login [name=email]').fill(user.email);await page.locator('#cloud-login [name=password]').fill('synthetic-test-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await expect(page.locator('.topbar [data-cloud-label]')).toHaveText('Đã đồng bộ');
}
