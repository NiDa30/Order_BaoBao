import {orderTotal,paymentTotals,reportTotals} from './permissions.js';
const statusLabel={open:'Đang phục vụ',paid:'Đã thanh toán',cancelled:'Đã hủy'};
// Quote every cell and neutralize spreadsheet formulas in user-entered text.
export function csvCell(value){
 let text=String(value??'');
 if(typeof value==='string'&&/^[\s\uFEFF]*[=+\-@]/.test(text))text="'"+text;
 return '"'+text.replaceAll('"','""')+'"';
}
export const csv=rows=>'\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
export function exportSelection(db,filters){
 const matches=o=>(!filters.from||o.day>=filters.from)&&(!filters.to||o.day<=filters.to)&&(!filters.shift||o.shift===Number(filters.shift));
 return {orders:db.orders.filter(o=>matches(o)&&(!filters.status||o.status===filters.status)).sort((a,b)=>a.created.localeCompare(b.created)),closings:db.closings.filter(matches).sort((a,b)=>a.day.localeCompare(b.day)||a.shift-b.shift)};
}
export function buildExport(db,filters,context={}){
 if(!['backup','menu'].includes(filters.type)&&filters.from&&filters.to&&filters.from>filters.to)throw new Error('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
 const {orders,closings}=exportSelection(db,filters);
 const range=`${filters.from||'tat-ca'}_${filters.to||'tat-ca'}${filters.shift?`_ca-${filters.shift}`:''}`;
 let rows,name,count;
 if(filters.type==='backup')return {text:JSON.stringify({...db,_export:{schemaVersion:1,exportedAt:new Date().toISOString(),shopName:context.shopName||'Lam An',syncStatus:context.syncStatus||'unknown'}},null,2),mime:'application/json',name:`lam-an-sao-luu-${context.day||'data'}.json`,count:db.orders.length};
 if(filters.type==='menu'){
  rows=[['Mã món','Tên món','Nhóm','Đơn giá (VNĐ)'],...db.menu.map(m=>[m.id,m.name,m.category,m.price])];name='thuc-don';count=db.menu.length;
 }else if(filters.type==='orders'){
  rows=[['Mã đơn','Ngày','Ca','Bàn / Số order','Khách hàng','Trạng thái','Tổng giá trị đơn (VNĐ)','Doanh thu đơn (VNĐ)','Tiền mặt thuần','Chuyển khoản thuần','Chưa rõ phương thức','Tạo lúc','Người tạo','Thanh toán lúc','Người thu','Sửa gần nhất','Người sửa','Ghi chú','Lý do hủy','Tiền hoàn khi hủy'],...orders.map(o=>{const p=paymentTotals(o);return [o.code,o.day,o.shift,o.table,o.customer,statusLabel[o.status]||o.status,orderTotal(o),o.status==='paid'?orderTotal(o):0,p.cash||0,p.transfer||0,p.unknown||0,o.created,o.createdByEmail,o.paidAt,o.paidByEmail,o.updatedAt,o.updatedByEmail,o.note,o.cancelReason,o.refundAmount||0];})];name='don-hang';count=orders.length;
 }else if(filters.type==='items'){
  rows=[['Mã đơn','Ngày','Ca','Trạng thái','Mã món','Tên món','Số lượng','Đơn giá (VNĐ)','Thành tiền (VNĐ)'],...orders.flatMap(o=>o.items.map(i=>[o.code,o.day,o.shift,statusLabel[o.status]||o.status,i.id,i.name,i.qty,i.price,i.qty*i.price]))];name='chi-tiet-mon';count=rows.length-1;
 }else if(filters.type==='shifts'){
  rows=[['Ngày','Ca','Thời điểm kết','Người kết','Số đơn thanh toán','Doanh thu đã chốt (VNĐ)','Doanh thu gốc (VNĐ)','Điều chỉnh (VNĐ)','Tiền mặt hệ thống','Tiền mặt thực đếm','Chênh lệch','Ghi chú'],...closings.map(c=>[c.day,c.shift,c.at,c.closedByEmail,c.count,c.revenue,c.originalRevenue??c.revenue,(c.adjustments||[]).reduce((s,a)=>s+a.amount,0),c.expectedCash,c.actualCash,c.discrepancy,c.note])];name='bao-cao-ca';count=closings.length;
 }else if(filters.type==='revenue'){
  // Status filtering does not apply to revenue reports: paid orders and manual corrections define revenue.
  const all=exportSelection(db,{...filters,status:''}).orders;
  const groups=[...new Set([...all.map(o=>`${o.day}:${o.shift}`),...closings.map(c=>`${c.day}:${c.shift}`)])].sort();
  rows=[['Ngày','Ca','Tổng đơn','Đơn thanh toán','Đơn hủy','Doanh thu thuần (VNĐ)','Tiền mặt thuần','Chuyển khoản thuần','Chưa rõ phương thức','Điều chỉnh (VNĐ)'],...groups.map(k=>{const [day,shift]=k.split(':'),r=reportTotals(all.filter(o=>o.day===day&&o.shift===Number(shift)),closings.filter(c=>c.day===day&&c.shift===Number(shift)));return [day,Number(shift),r.count,r.paid,r.cancelled,r.revenue,r.cash,r.transfer,r.unknown,r.adjustment];})];name='doanh-thu';count=groups.length;
 }else throw new Error('Loại dữ liệu xuất không hợp lệ.');
 return {text:csv(rows),mime:'text/csv;charset=utf-8',name:`lam-an-${name}-${filters.type==='menu'?'tat-ca':range}.csv`,count};
}
export function exportPage(db,filters,esc,syncStatus){
 const ranged=!['backup','menu'].includes(filters.type),statusFilter=['orders','items'].includes(filters.type);
 const result=ranged&&filters.from&&filters.to&&filters.from>filters.to?null:buildExport(db,filters);
 return `<div class="page-heading"><div><div class="eyebrow">DỮ LIỆU QUÁN, LUÔN TRONG TẦM TAY</div><h1>Xuất dữ liệu</h1><p>Tải file CSV mở bằng Excel hoặc bản sao lưu JSON đầy đủ.</p></div></div><div class="export-layout"><form id="data-export-form" class="management-panel"><h2>Chọn dữ liệu cần xuất</h2><label>Loại dữ liệu<select id="export-type" name="type">${[['orders','Danh sách đơn hàng · CSV'],['items','Chi tiết món trong đơn · CSV'],['shifts','Báo cáo kết ca · CSV'],['revenue','Doanh thu theo ngày / ca · CSV'],['menu','Toàn bộ thực đơn · CSV'],['backup','Sao lưu toàn bộ dữ liệu POS · JSON']].map(([v,t])=>`<option value="${v}" ${filters.type===v?'selected':''}>${t}</option>`).join('')}</select></label><div class="export-dates"><label>Từ ngày<input type="date" id="export-from" value="${esc(filters.from)}" ${ranged?'':'disabled'}></label><label>Đến ngày<input type="date" id="export-to" value="${esc(filters.to)}" ${ranged?'':'disabled'}></label></div><label>Ca<select id="export-shift" ${ranged?'':'disabled'}><option value="">Tất cả ca</option>${[1,2,3].map(n=>`<option value="${n}" ${filters.shift===String(n)?'selected':''}>Ca ${n}</option>`).join('')}</select></label><label>Trạng thái đơn<select id="export-status" ${statusFilter?'':'disabled'}>${[['','Tất cả trạng thái'],['open','Đang phục vụ'],['paid','Đã thanh toán'],['cancelled','Đã hủy']].map(([v,t])=>`<option value="${v}" ${filters.status===v?'selected':''}>${t}</option>`).join('')}</select></label>${!result?'<p class="form-error" role="alert">Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.</p>':''}<button class="primary full" type="submit" ${result?'':'disabled'}>↓ Tải file ${filters.type==='backup'?'JSON':'CSV'}</button></form><aside class="export-info"><div class="management-panel"><h2>Nội dung file</h2><div class="export-count">${result?result.count:'—'}<small>${filters.type==='backup'?'đơn trong bản sao lưu':filters.type==='menu'?'món':filters.type==='items'?'dòng món':filters.type==='orders'?'đơn hàng':'dòng báo cáo'}</small></div><p class="muted">${filters.type==='backup'?'Gồm toàn bộ menu, đơn, chi tiết món, lịch sử sửa đơn và báo cáo ca hiện có. Không áp dụng bộ lọc. Không chứa mật khẩu hay token. Đây là bản dữ liệu POS, không phải bản sao lưu toàn bộ hệ thống Supabase.':filters.type==='menu'?'Xuất toàn bộ thực đơn và giá hiện tại, không lọc theo ngày.':'Để trống ngày để lấy toàn bộ khoảng thời gian. File chỉ gồm dữ liệu khớp bộ lọc đã chọn.'}</p></div><p class="${syncStatus==='synced'?'note':'warning'}">${syncStatus==='synced'?'Dữ liệu đã đồng bộ gần nhất. File được tạo từ dữ liệu đang có trên thiết bị này.':'Có thể còn dữ liệu chưa đồng bộ. File gồm bản hiện có trên máy; nên đồng bộ các thiết bị trước khi xuất báo cáo chính thức.'}</p><button class="secondary full" type="button" data-action="cloud-sync">↻ Đồng bộ dữ liệu</button><p class="muted">Chỉ admin được xuất. Chức năng này tải file, không xóa hoặc thay đổi dữ liệu. Chưa có chức năng nhập file để khôi phục tự động.</p></aside></div>`;
}
