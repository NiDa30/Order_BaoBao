import {createClient} from '@supabase/supabase-js';
import {clone,same,isSnapshot,mergeSnapshots,SyncConflict} from './sync-state.js';
export const LOCAL_KEY='lam-an-pos-v1';
const url=import.meta.env.VITE_SUPABASE_URL?.trim();
const key=(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY||import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim();
const empty=()=>({menu:[],orders:[],closings:[]});
function publicKey(value) {
  if(value?.startsWith('sb_publishable_'))return true;
  try{return JSON.parse(atob(value.split('.')[1])).role==='anon';}catch{return false;}
}
function readJSON(key){try{return JSON.parse(localStorage.getItem(key));}catch{return null;}}
function friendly(error) {
  if(error instanceof SyncConflict)return error.message;
  if(['PGRST202','42P01','42883'].includes(error.code))return 'Database chưa được khởi tạo. Cần chạy migration Supabase của dự án.';
  if(error.code==='42501')return 'Tài khoản chưa được cấp quyền truy cập dữ liệu.';
  if(error.code==='23514')return 'Dữ liệu chưa hợp lệ để lưu lên database. Bản trên máy vẫn được giữ lại.';
  if(error.message?.includes('Invalid login credentials'))return 'Email hoặc mật khẩu chưa đúng.';
  if(error.message?.includes('Email not confirmed'))return 'Email chưa được xác nhận trong Supabase.';
  return 'Chưa kết nối được Supabase. Dữ liệu trên máy vẫn được giữ; hãy kiểm tra mạng và thử lại.';
}
export function createCloudStore(seed,{onData=()=>{},onStatus=()=>{}}={}) {
  let data=readJSON(LOCAL_KEY);
  if(!isSnapshot(data))data={menu:clone(seed),orders:[],closings:[]};
  let configError='';
  if(url||key){try{if(!url||!key||new URL(url).protocol!=='https:'||!publicKey(key))throw new Error();}catch{configError='Cấu hình Supabase chưa hợp lệ. Chỉ dùng Project URL HTTPS và publishable/anon public key.';}}
  const client=url&&key&&!configError?createClient(url,key):null;
  let session=null,scope=null,envelope=null,running=false,again=false,generation=0,authReady=false;
  const status={mode:configError?'config-error':client?'loading':'local',message:configError,email:'',lastSync:null};
  const notify=patch=>{Object.assign(status,patch);onStatus({...status,configured:!!client,pending:!!envelope&&!same(envelope.local,envelope.base)});};
  const writeCache=(value)=>localStorage.setItem(scope||LOCAL_KEY,JSON.stringify(value));
  const apply=(value)=>{if(same(data,value))return;data=clone(value);onData(clone(data));};
  const cache=(next)=>{writeCache(next);envelope=next;apply(next.local);};
  function persist(next) {
    if(!session)return {ok:false,message:'Vui lòng đăng nhập trước khi sử dụng quầy bán hàng.'};
    if(status.mode==='loading')return {ok:false,message:'Đang tải dữ liệu tài khoản. Vui lòng đợi một chút.'};
    try {
      if(scope){const latest=readJSON(scope);if(latest&&isSnapshot(latest.local)&&isSnapshot(latest.base)){next=mergeSnapshots(data,next,latest.local);envelope=latest;}cache({...envelope,local:clone(next)});}
      else{const latest=readJSON(LOCAL_KEY);if(isSnapshot(latest))next=mergeSnapshots(data,next,latest);writeCache(next);data=clone(next);}
      if(scope){notify({mode:'pending',message:'Đã lưu trên máy, đang chờ đồng bộ.'});void sync();}
      return {ok:true};
    }catch(error){return {ok:false,message:error instanceof SyncConflict?friendly(error):'Không thể lưu dữ liệu trên máy. Hãy kiểm tra dung lượng trình duyệt.'};}
  }
  async function sync() {
    if(!client||!session||!envelope)return;
    if(running){again=true;return;}
    running=true;
    const token=generation;
    try {
      for(let attempt=0;attempt<4;attempt++) {
        if(token!==generation)return;
        again=false;notify({mode:'syncing',message:'Đang đồng bộ với Supabase…'});
        const {data:row,error}=await client.rpc('pos_read_workspace');
        if(error)throw error;
        if(token!==generation)return;
        const remote=row?.data||empty(),revision=row?.revision||0;
        if(!isSnapshot(remote))throw new Error('Invalid remote snapshot');
        const base=clone(envelope.base),local=clone(envelope.local);
        const merged=mergeSnapshots(base,local,remote);
        if(!row&&!merged.menu.length&&!merged.orders.length&&!merged.closings.length)merged.menu=clone(seed);
        let saved={data:remote,revision};
        if(!same(merged,remote)) {
          const result=await client.rpc('pos_save_workspace',{expected_revision:revision,next_data:merged});
          if(token!==generation)return;
          if(result.error?.code==='40001'){if(attempt<3)continue;throw new SyncConflict();}
          if(result.error)throw result.error;
          saved=result.data;
          if(!isSnapshot(saved?.data))throw new Error('Invalid saved snapshot');
        }
        // New local actions may have happened while the request was in flight.
        const latest=readJSON(scope);
        const current=mergeSnapshots(local,latest&&isSnapshot(latest.local)?latest.local:envelope.local,saved.data);
        cache({base:clone(saved.data),local:current,revision:saved.revision});
        if(!same(current,saved.data)||again)continue;
        notify({mode:'synced',message:'Menu, đơn hàng và báo cáo ca đã được lưu trên Supabase.',lastSync:new Date().toISOString()});
        return;
      }
      notify({mode:'pending',message:'Còn thay đổi đang chờ đồng bộ. Hãy thử lại.'});
    }catch(error){
      if(token!==generation)return;
      notify({mode:error instanceof SyncConflict?'conflict':'error',message:friendly(error)});
    }finally{running=false;if(token!==generation&&session)void sync();}
  }
  async function setSession(next) {
    if(authReady&&(session?.user.id||null)===(next?.user.id||null)) {session=next;return;}
    authReady=true;generation++;session=next;
    if(!session){
      scope=null;envelope=null;
      const legacy=readJSON(LOCAL_KEY);apply(isSnapshot(legacy)?legacy:{menu:clone(seed),orders:[],closings:[]});
      notify({mode:client?'login':'local',email:'',lastSync:null,message:client?'Đăng nhập để lưu và dùng dữ liệu trên nhiều thiết bị.':''});return;
    }
    scope=`lam-an-cloud-v1:${new URL(url).hostname}:${session.user.id}`;
    const cached=readJSON(scope);
    envelope=cached&&isSnapshot(cached.local)&&isSnapshot(cached.base)?cached:{base:empty(),local:{menu:[],orders:[],closings:[]},revision:0};
    apply(envelope.local);notify({mode:'loading',email:session.user.email||'',lastSync:null,message:'Đang tải dữ liệu tài khoản…'});
    // New accounts start with the menu only, never silently upload local sales.
    apply(envelope.local);
    await sync();
  }
  async function start() {
    if(!client){authReady=true;notify({});return;}
    const {data:auth,error}=await client.auth.getSession();
    if(error){authReady=true;notify({mode:'error',message:friendly(error)});return;}
    await setSession(auth.session);
    client.auth.onAuthStateChange((_event,next)=>{
      // Avoid awaiting Supabase calls in the auth callback (auth-js lock).
      setTimeout(()=>void setSession(next),0);
    });
  }
  async function login(email,password) {
    if(!client)return {ok:false,message:'Chưa có cấu hình Supabase cho ứng dụng.'};
    const {data:auth,error}=await client.auth.signInWithPassword({email,password});
    if(error)return {ok:false,message:friendly(error)};
    await setSession(auth.session);return {ok:true};
  }
  async function logout() {
    if(envelope&&!same(envelope.local,envelope.base))return {ok:false,message:'Còn dữ liệu chưa đồng bộ. Hãy đồng bộ hoặc xuất dữ liệu trước khi đăng xuất.'};
    const {error}=await client.auth.signOut({scope:'local'});
    if(error)return {ok:false,message:friendly(error)};
    await setSession(null);return {ok:true};
  }
  function importLocal() {
    if(!session||!envelope)return {ok:false,message:'Hãy đăng nhập trước khi nhập dữ liệu.'};
    const local=readJSON(LOCAL_KEY);
    if(!isSnapshot(local))return {ok:false,message:'Không có dữ liệu cũ để nhập.'};
    if(data.orders.length||data.closings.length)return {ok:false,message:'Tài khoản đã có dữ liệu bán hàng. Hãy xuất dữ liệu cũ để đối chiếu; không tự ghi đè dữ liệu trên database.'};
    if(!same(data.menu,seed))return {ok:false,message:'Thực đơn tài khoản đã được chỉnh sửa. Hãy xuất dữ liệu cũ để đối chiếu trước khi nhập.'};
    return persist(clone(local));
  }
  async function useRemote() {
    if(!session||!client)return {ok:false,message:'Hãy đăng nhập trước.'};
    try {
      const {data:row,error}=await client.rpc('pos_read_workspace');if(error)throw error;
      if(!isSnapshot(row?.data))return {ok:false,message:'Chưa có dữ liệu trên database để tải.'};
      localStorage.setItem(`${scope}:backup:${Date.now()}`,JSON.stringify(envelope));
      cache({base:clone(row.data),local:clone(row.data),revision:row.revision});
      notify({mode:'synced',message:'Đã lấy bản trên database. Bản trên máy trước đó được giữ trong bản sao cục bộ.',lastSync:new Date().toISOString()});return {ok:true};
    }catch(error){return {ok:false,message:friendly(error)};}
  }
  // Polling also recovers missed changes; realtime is not required for correctness.
  const interval=setInterval(()=>{if(session&&status.mode!=='conflict'&&document.visibilityState==='visible')void sync();},30000);
  window.addEventListener('online',()=>void sync());
  window.addEventListener('storage',event=>{
    if(!scope&&event.key===LOCAL_KEY){const latest=readJSON(LOCAL_KEY);if(isSnapshot(latest))apply(latest);return;}
    if(!scope||event.key!==scope)return;
    const latest=readJSON(scope);
    if(latest&&isSnapshot(latest.base)&&isSnapshot(latest.local)){envelope=latest;apply(latest.local);notify({mode:same(latest.local,latest.base)?'synced':'pending',message:same(latest.local,latest.base)?'Đã nhận dữ liệu từ tab khác.':'Đã nhận thay đổi đang chờ đồng bộ từ tab khác.'});}
  });
  return {read:()=>clone(data),persist,start,login,logout,sync,importLocal,useRemote,status:()=>({...status,configured:!!client,authReady}),legacy:()=>readJSON(LOCAL_KEY),hasSession:()=>!!session,destroy:()=>{clearInterval(interval);client?.auth.stopAutoRefresh();}};
}
