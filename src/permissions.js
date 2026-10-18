export const isAdmin=access=>access?.role==='admin';
export const canShift=(access,day,shift)=>isAdmin(access)||!!access?.assignments?.some(a=>a.day===day&&Number(a.shift)===Number(shift)&&a.user_id===access.userId);
export function visibleData(data,access){
 if(!access)return {menu:[],orders:[],closings:[]};
 if(isAdmin(access))return data;
 return {...data,orders:data.orders.filter(o=>canShift(access,o.day,o.shift)),closings:data.closings.filter(c=>canShift(access,c.day,c.shift))};
}
export const orderTotal=o=>o.items.reduce((s,i)=>s+i.price*i.qty,0);
export function paymentTotals(o){
 if(o.status!=='paid')return {cash:0,transfer:0,unknown:0};
 return o.paymentTotals||{cash:o.paymentMethod==='cash'?orderTotal(o):0,transfer:o.paymentMethod==='transfer'?orderTotal(o):0,unknown:!['cash','transfer'].includes(o.paymentMethod)?orderTotal(o):0};
}
export function reportTotals(orders,closings){
 const paid=orders.filter(o=>o.status==='paid');const sums={revenue:0,cash:0,transfer:0,unknown:0,paid:paid.length,cancelled:orders.filter(o=>o.status==='cancelled').length,count:orders.length,adjustment:0};
 for(const o of paid){sums.revenue+=orderTotal(o);const p=paymentTotals(o);sums.cash+=p.cash||0;sums.transfer+=p.transfer||0;sums.unknown+=p.unknown||0;}
 for(const c of closings)for(const a of c.adjustments||[]){sums.revenue+=a.amount;sums.adjustment+=a.amount;sums[a.method]+=a.amount;}
 return sums;
}
export function periodRange(day,period){
 const date=new Date(`${day}T12:00:00Z`);let start=new Date(date),end=new Date(date);
 if(period==='week'){const n=(date.getUTCDay()+6)%7;start.setUTCDate(start.getUTCDate()-n);end=new Date(start);end.setUTCDate(end.getUTCDate()+6);}
 if(period==='month'){start.setUTCDate(1);end=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0,12));}
 return [start.toISOString().slice(0,10),end.toISOString().slice(0,10)];
}
