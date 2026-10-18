import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
Deno.serve(async request=>{
 const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...headers,'Content-Type':'application/json'}});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 const authorization=request.headers.get('Authorization');
 if(!authorization?.startsWith('Bearer '))return json({error:'Authentication required'},401);
 try{
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  // Verify the user's JWT, then ask the database for the CURRENT active membership.
  const caller=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
  const {data:identity,error:authError}=await caller.auth.getUser();
  if(authError||!identity.user)return json({error:'Authentication required'},401);
  const {data:workspace,error:accessError}=await caller.rpc('pos_read_workspace');
  if(accessError||workspace?.access?.role!=='admin')return json({error:'Chỉ admin được tạo tài khoản'},403);
  const payload=await request.json();
  const email=String(payload.email||'').trim(),name=String(payload.name||'').trim(),role=String(payload.role||'staff'),password=String(payload.password||'');
  if(!email.includes('@')||email.length>254||!name||name.length>100||password.length<8||!['admin','staff'].includes(role))return json({error:'Kiểm tra email, tên, mật khẩu (ít nhất 8 ký tự) và vai trò.'},400);
  const service=createClient(url,serviceKey,{auth:{persistSession:false}});
  const {data:created,error:createError}=await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:name}});
  if(createError)return json({error:'Chưa tạo được tài khoản. Nếu email đã tồn tại, dùng Thêm email đã có tài khoản.'},400);
  // Do not log/store the password or include it in the audited database operation.
  const {error:memberError}=await caller.rpc('pos_manage',{action:'member.add',payload:{email,name,role}});
  if(memberError)return json({error:'Tài khoản Auth đã tạo nhưng chưa gắn vào quán. Admin có thể thử Thêm email đã có tài khoản.'},409);
  return json({userId:created.user.id});
 }catch{return json({error:'Không thực hiện được. Hãy kiểm tra cấu hình Edge Function và thử lại.'},500);}
});
