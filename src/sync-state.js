export const clone=value=>structuredClone(value);
// Postgres jsonb reorders object keys; equality must not depend on serialization order.
export function same(a,b){
  if(Object.is(a,b))return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const left=Object.keys(a),right=Object.keys(b);
  return left.length===right.length&&left.every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]));
}
export const isSnapshot=value=>value && ['menu','orders','closings'].every(key=>Array.isArray(value[key]));
export class SyncConflict extends Error {
  constructor(message='Dữ liệu đã thay đổi trên thiết bị khác. Các thay đổi trên máy vẫn được giữ lại.') {
    super(message);this.name='SyncConflict';
  }
}
const recordKey=(kind,item)=>kind==='closings'?`${item.day}:${item.shift}`:item.id;

// Three-way merge: independent records merge; concurrent edits to one record never silently overwrite.
export function mergeSnapshots(base,local,remote) {
  const result={menu:[],orders:[],closings:[]};
  for(const kind of Object.keys(result)) {
    const index=snapshot=>new Map(snapshot[kind].map(item=>[recordKey(kind,item),item]));
    const b=index(base),l=index(local),r=index(remote);
    for(const id of new Set([...b.keys(),...l.keys(),...r.keys()])) {
      const before=b.get(id),mine=l.get(id),theirs=r.get(id);
      let chosen;
      if(same(mine,before))chosen=theirs;
      else if(same(theirs,before)||same(mine,theirs))chosen=mine;
      else throw new SyncConflict(`Cùng một ${kind==='orders'?'đơn hàng':kind==='menu'?'món':'ca'} đã được sửa trên hai thiết bị. Các thay đổi trên máy vẫn được giữ lại.`);
      if(chosen)result[kind].push(clone(chosen));
    }
  }
  const newlyAdded=(source,other)=>source.orders.filter(o=>!base.orders.some(b=>b.id===o.id)&&!other.orders.some(r=>r.id===o.id));
  for(const [source,other] of [[local,remote],[remote,local]]) {
    if(newlyAdded(source,other).some(o=>other.closings.some(c=>c.day===o.day&&c.shift===o.shift))) {
      throw new SyncConflict('Ca đã kết trên thiết bị khác nhưng máy này còn đơn mới chưa đồng bộ. Hãy xuất dữ liệu trên máy để đối chiếu trước.');
    }
  }
  for(const closing of result.closings) {
    const orders=result.orders.filter(o=>o.day===closing.day&&o.shift===closing.shift);
    if(orders.some(o=>o.status!=='paid'))throw new SyncConflict('Ca có đơn chưa thanh toán trên thiết bị khác. Chưa thể đồng bộ kết ca.');
    const revenue=orders.reduce((sum,o)=>sum+o.items.reduce((v,i)=>v+i.price*i.qty,0),0);
    if(revenue!==closing.revenue||closing.count!==orders.length) {
      closing.originalRevenue??=closing.revenue;
      closing.revenue=revenue;closing.count=orders.length;
      closing.updatedAt=new Date().toISOString();
    }
  }
  return result;
}
