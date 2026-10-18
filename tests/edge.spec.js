import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {runInNewContext} from 'node:vm';
function harness({valid=true,role='admin'}={}){
 const calls=[];let handler;
 const caller={auth:{getUser:async()=>valid?{data:{user:{id:'actor'}},error:null}:{data:{user:null},error:new Error('invalid')}},rpc:async(name,args)=>{calls.push({name,args});return name==='pos_read_workspace'?{data:{access:{role}}}:{data:{},error:null};}};
 const service={auth:{admin:{createUser:async payload=>{calls.push({createUser:payload});return {data:{user:{id:'new-user'}},error:null};}}}};
 const source=readFileSync('supabase/functions/pos-create-member/index.ts','utf8').replace("import {createClient} from 'npm:@supabase/supabase-js@2.118.0';",'');
 const code=transformSync(source,{loader:'ts',format:'cjs'}).code;
 runInNewContext(code,{Deno:{env:{get:name=>name==='SUPABASE_SERVICE_ROLE_KEY'?'server-secret':'public'},serve:fn=>{handler=fn;}},createClient:(_url,key)=>key==='server-secret'?service:caller,Response,Request,JSON,String});
 return {calls,request:async(token=true)=>handler(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer test-token'}:{})},body:JSON.stringify({email:'new@example.test',name:'Nhân viên',password:'temporary-password',role:'staff'})}))};
}
test('account creation endpoint refuses missing JWT, invalid JWT and staff before service-key action',async()=>{
 for(const options of [{valid:false},{role:'staff'}]){const h=harness(options),r=await h.request();expect([401,403]).toContain(r.status);expect(h.calls.some(c=>c.createUser)).toBe(false);}const h=harness();expect((await h.request(false)).status).toBe(401);expect(h.calls).toHaveLength(0);
});
test('verified admin creates Auth user and attaches membership without auditing password',async()=>{
 const h=harness(),r=await h.request();expect(r.status).toBe(200);expect(h.calls.find(c=>c.createUser).createUser.password).toBe('temporary-password');const membership=h.calls.find(c=>c.name==='pos_manage');expect(membership.args.payload).toEqual({email:'new@example.test',name:'Nhân viên',role:'staff'});expect(membership.args.payload.password).toBeUndefined();
});
