import {test,expect} from '@playwright/test';
import {clone,same,mergeSnapshots,SyncConflict} from '../src/sync-state.js';
const base=()=>({menu:[{id:'m1',name:'Cà phê sữa',category:'Cà phê',price:22000}],orders:[],closings:[]});
const order=(id)=>({id,day:'2026-10-18',shift:1,status:'open',items:[{id:'m1',name:'Cà phê sữa',price:22000,qty:1}]});
test('JSONB key order does not create false conflicts',()=>{
 expect(same({id:'x',name:'a',items:[{qty:2,price:22000}]},{items:[{price:22000,qty:2}],name:'a',id:'x'})).toBe(true);
 expect(same({id:'x'},{id:'y'})).toBe(false);
 const local=base(),remote=base();remote.menu=[{price:22000,category:'Cà phê',name:'Cà phê sữa',id:'m1'}];expect(mergeSnapshots(base(),local,remote)).toEqual(local);
});
test('independent offline orders merge and repeated sync does not duplicate',()=>{
 const b=base(),local=clone(b),remote=clone(b);local.orders.push(order('a'));remote.orders.push(order('b'));
 const merged=mergeSnapshots(b,local,remote);expect(merged.orders.map(o=>o.id).sort()).toEqual(['a','b']);expect(mergeSnapshots(merged,merged,merged)).toEqual(merged);
});
test('conflicting edits never silently overwrite',()=>{
 const b=base();b.orders.push(order('a'));const local=clone(b),remote=clone(b);local.orders[0].items[0].qty=2;remote.orders[0].items[0].qty=3;
 expect(()=>mergeSnapshots(b,local,remote)).toThrow(SyncConflict);expect(local.orders[0].items[0].qty).toBe(2);
});
test('new offline order conflicts with a shift closed on another device',()=>{
 const b=base(),local=clone(b),remote=clone(b);local.orders.push(order('a'));remote.closings.push({day:'2026-10-18',shift:1,revenue:0,count:0});
 expect(()=>mergeSnapshots(b,local,remote)).toThrow(/Ca đã kết/);
});
test('editing a closed paid order updates closing without changing original amount',()=>{
 const b=base();b.orders.push({...order('a'),status:'paid'});b.closings.push({day:'2026-10-18',shift:1,revenue:22000,count:1});const local=clone(b);local.orders[0].items[0].qty=2;
 const result=mergeSnapshots(b,local,clone(b));expect(result.closings[0].revenue).toBe(44000);expect(result.closings[0].originalRevenue).toBe(22000);expect(result.closings[0].count).toBe(1);
});
