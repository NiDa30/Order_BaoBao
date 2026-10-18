import {expect} from '@playwright/test';
const endpoint='https://test-project.supabase.co';
const user={id:'11111111-1111-4111-8111-111111111111',email:'pos@example.test',aud:'authenticated',role:'authenticated',created_at:'2026-01-01T00:00:00Z',app_metadata:{},user_metadata:{}};
const jwt=()=>`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:user.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.test-signature`;
export async function mock(context,server){
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 server.access??={shopId:'test-shop',shopName:'Lam An',userId:user.id,email:user.email,role:'admin',assignments:[],members:[{user_id:user.id,email:user.email,role:'admin',active:true,display_name:'Admin'}],proposals:[]};
 server.access.shiftSessions??=[1,2,3].map(shift=>({day,shift,status:'open',opened_by:user.id,opened_by_email:'staff@example.test'}));
 const view=()=>{const w=server.workspace||{data:{menu:[],orders:[],closings:[]},revision:0};return {...w,access:server.access};};

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
  if(path==='/rest/v1/rpc/pos_read_workspace'){if(server.blocked)return reply({code:'42501',message:'Blocked'},403);return reply(view());}
  if(path==='/rest/v1/rpc/pos_save_workspace'){
   const body=request.postDataJSON();
   if(body.expected_revision!==(server.workspace?.revision||0))return reply({code:'40001',message:'Conflict'},409);
   server.workspace={revision:(server.workspace?.revision||0)+1,data:structuredClone(body.next_data)};
   return reply(view());
  }
  if(path==='/rest/v1/rpc/pos_list_audit')return reply(server.audit||[]);
  if(path==='/rest/v1/rpc/pos_manage'){
   const {action,payload}=request.postDataJSON();server.calls??=[];server.calls.push({action,payload});
   if(action==='shift.open'){server.access.assignments.push({day:payload.day,shift:payload.shift,user_id:user.id});server.access.shiftSessions=server.access.shiftSessions.filter(s=>s.day!==payload.day||s.shift!==payload.shift);server.access.shiftSessions.push({...payload,status:'open',opened_by:user.id,opened_by_email:user.email});}
   if(action==='member.add')server.access.members.push({user_id:'staff-new',email:payload.email,display_name:payload.name,role:payload.role,active:true});
   if(action==='member.update'){const m=server.access.members.find(m=>m.user_id===payload.userId);Object.assign(m,payload);}
   if(action==='assignment.set'){
    server.access.assignments=server.access.assignments.filter(a=>!(a.user_id===payload.userId&&a.day===payload.day&&a.shift===payload.shift));
    if(payload.enabled)server.access.assignments.push({user_id:payload.userId,day:payload.day,shift:payload.shift,shop_id:'test-shop'});
   }
   if(action==='proposal.submit')server.access.proposals.push({id:'proposal-new',email:user.email,payload:payload.item,reason:payload.reason,status:'pending'});
   if(action==='proposal.review'){const p=server.access.proposals.find(p=>p.id===payload.id);p.status=payload.decision;if(p.status==='approved')server.workspace.data.menu.push(p.payload);}
   if(action==='shift.adjust'){const c=server.workspace.data.closings.find(c=>c.day===payload.day&&c.shift===payload.shift);c.originalRevenue??=c.revenue;c.revenue+=payload.amount;(c.adjustments??=[]).push(payload);}
   return reply(view());
  }
  return reply({message:'Unexpected test request'},404);
 });
}
export async function login(page){
 await page.goto('/');await page.locator('#cloud-login [name=email]').fill(user.email);await page.locator('#cloud-login [name=password]').fill('synthetic-test-password');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await expect(page.locator('.topbar [data-cloud-label]')).toHaveText('Đã đồng bộ');
}
