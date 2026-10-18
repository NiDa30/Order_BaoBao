# Lam An POS

Web tính tiền tiếng Việt cho quán cà phê, responsive điện thoại/desktop. Đăng nhập Supabase bắt buộc; admin và nhân viên cùng một quán dùng chung menu, đơn và báo cáo ca. Dữ liệu được cache trên máy, đồng bộ qua RPC có transaction và kiểm tra quyền.

## Chạy dự án

Node.js 20.19+ hoặc 22.12+:

```sh
npm ci --cache /tmp/npm-cache
npm run dev
npm run build
```

`npm run preview` chạy thử `dist`. Copy `.env.example` thành `.env.local`, điền `VITE_SUPABASE_URL` và `VITE_SUPABASE_PUBLISHABLE_KEY` (hoặc legacy `VITE_SUPABASE_ANON_KEY`). Trên Vercel đặt các biến trong Environment Variables rồi redeploy. Đây là cấu hình public frontend; không dùng service_role/secret key hoặc mật khẩu Postgres trong biến `VITE_...`.

## Nâng cấp từ bản mỗi tài khoản một workspace

1. Trước khi cập nhật, để mọi thiết bị hoàn tất đồng bộ và xuất bản sao dữ liệu cần giữ. Tránh bán hàng trong khoảng chuyển đổi schema.
2. Trong Supabase **SQL Editor**, chạy **toàn bộ** `supabase/migrations/202610180002_shop_roles.sql`. Không chọn riêng khối DECLARE. File chạy lại được và giữ nguyên bảng `pos_workspaces` cũ như bản lưu trữ; không xóa dữ liệu.
3. Tài khoản chủ quán phải có sẵn trong Authentication → Users. Chạy riêng trong SQL Editor:

```sql
select public.pos_bootstrap_shop('EMAIL_ADMIN_CUA_BAN');
```

Hàm này chỉ chạy được bởi quản trị database, không cấp quyền gọi cho anon/authenticated. Nó tạo quán và admin, copy nguyên dữ liệu cloud từ workspace cũ của tài khoản admin. Không tự gộp workspace riêng của các tài khoản khác; các bản đó vẫn còn trong bảng cũ để đối chiếu. Không tự chọn tài khoản đăng nhập đầu tiên làm admin.

4. Deploy frontend mới. Đăng nhập bằng admin, vào **Nhân viên**, thêm email nhân viên có sẵn và phân ca theo ngày. Mỗi tài khoản hiện thuộc tối đa một quán. Nếu chưa có membership hoặc bị khóa, ứng dụng chặn dashboard.
5. Chọn tài khoản mới trong POS cần triển khai Edge Function ở phần tiếp theo. Nếu chưa deploy function, admin vẫn có thể tạo Auth user trong Supabase rồi dùng **Thêm email đã có tài khoản**.

Không chạy lại migration `001` sau `002`, vì `002` thay thế RPC cũ. Dự án mới hoàn toàn: chạy `001`, tiếp theo `002`, rồi bootstrap admin.

Cache mới dùng `lam-an-cloud-v2:<project>:<user-id>` và giữ bản dữ liệu/access theo tài khoản. Cache `v1` và local `lam-an-pos-v1` được giữ nguyên. Nếu v1 còn thay đổi chưa đồng bộ, admin có nút **Xuất bản sao dữ liệu cũ trên máy** để đối chiếu. Chỉ nhập tự động vào quán chưa có đơn, báo cáo và chưa sửa menu; không tự ghi đè dữ liệu quán đang hoạt động.

## Tạo tài khoản mới từ POS

Triển khai function `supabase/functions/pos-create-member/index.ts` tới đúng dự án Supabase. Với Supabase CLI đã đăng nhập:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy pos-create-member
```

`supabase/config.toml` đặt `verify_jwt=false` ở gateway để hỗ trợ signing keys mới. **Handler tự xác minh JWT bằng `auth.getUser()` và kiểm tra membership admin đang hoạt động trong database trước khi dùng service role.** Không bỏ các kiểm tra trong handler. Có thể deploy cùng nội dung bằng Supabase Dashboard → Edge Functions → editor và cấu hình gateway tương ứng.

Supabase tự cung cấp các biến server `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` cho function. Không đưa service role vào frontend. Admin nhập email, họ tên, mật khẩu tạm ít nhất 8 ký tự và vai trò. Function tạo Auth user rồi thêm membership qua RPC; không log/lưu mật khẩu vào bảng audit. Nhân viên đổi mật khẩu tại phần tài khoản/đồng bộ sau khi đăng nhập. Nếu Auth user tạo được nhưng gắn membership lỗi, dùng **Thêm email đã có tài khoản** để thử lại, không tự xóa Auth user.

## Quyền và nghiệp vụ

| Chức năng | Admin | Nhân viên |
|---|---|---|
| Menu, tạo/sửa đơn chưa thu, xác nhận tiền mặt/chuyển khoản | Tất cả ca | Ca được phân công theo ngày |
| Sửa đơn đã thanh toán | Tất cả đơn | Đơn thuộc ca được phân công, không chờ duyệt |
| Hủy đơn | Cả đơn chưa/đã thu | Chỉ đơn chưa thu trong ca được phân công |
| Thay đổi menu, đổi giá | Cập nhật trực tiếp; duyệt đề xuất | Gửi đề xuất, không trực tiếp đổi menu chung |
| Doanh thu | Ngày, tuần (thứ Hai–Chủ nhật), tháng, lọc ca | Chỉ ca được phân công |
| Mở / đóng ca | Không | Ca được phân công |
| Điều chỉnh ca đã kết | Có, phải ghi lý do | Không |
| Tài khoản, phân ca, khóa quyền, đổi vai trò | Có; không khóa/hạ quyền chủ quán | Không |
| Xuất đơn/báo cáo, nhật ký | JSON dữ liệu, CSV báo cáo; 500 nhật ký gần nhất | Không |

- Mỗi ngày theo múi giờ Việt Nam có 3 ca được chọn thủ công. Mã đơn có UUID suffix để tránh trùng khi nhiều máy tạo offline; bàn 1–15, tên/số tùy ý hoặc tên khách đều được hỗ trợ.
- Sửa đơn đã thanh toán bắt buộc lý do. Khi đổi tổng tiền phải xác nhận đã thu thêm/hoàn chênh lệch và chọn tiền mặt/chuyển khoản. Giá đơn cũ không thay đổi theo giá menu mới. Không tự thực hiện giao dịch ngân hàng.
- Database gắn tài khoản tạo/sửa/thu/hủy, thời gian và revision trước sửa; client không thể giả mạo actor. Nhật ký lưu before/after bất biến qua các RPC, không có API xóa nhật ký/đơn/ca.
- Hủy đơn giữ lịch sử và loại khỏi doanh thu. Hủy đơn đã thu chỉ admin, bắt buộc lý do và xác nhận đã hoàn đủ theo phương thức đã thu.
- Kết ca cần giải quyết hết đơn mở, nhập tiền mặt thực đếm và ghi chú nếu lệch. Báo cáo ghi tiền hệ thống, thực đếm, chênh lệch và người kết. Đơn hủy không tính doanh thu. Đơn cũ chưa có đối chiếu hiển thị “Chưa đối chiếu”.
- Ca đã kết không nhận đơn mới. Sửa đơn đã thu trong ca đó tự cập nhật báo cáo và giữ gốc; đây khác với khoản điều chỉnh ca thủ công chỉ admin được ghi. Điều chỉnh có số tiền dương/âm, phương thức và lý do, được tính vào doanh thu ngày/tuần/tháng.
- Doanh thu tách dòng tiền mặt/chuyển khoản, bao gồm xử lý chênh lệch sau chỉnh sửa; dữ liệu cũ không có phương thức được hiển thị riêng, không tự suy đoán.

## Dữ liệu và phân quyền

- `pos_shops` giữ JSONB snapshot của quán. `pos_members`, `pos_assignments`, `pos_proposals`, `pos_audit` giữ thành viên, phân ca, đề xuất và nhật ký. Tất cả bật RLS, không cho anon/authenticated trực tiếp đọc/ghi các bảng snapshot. Chỉ các RPC đã xác thực được truy cập; RPC trả dữ liệu nhân viên đã lọc theo ca ngay tại database.
- Mỗi lần ghi dùng CAS revision và khóa transaction. Đơn độc lập được gộp theo ID; hai thiết bị sửa cùng bản ghi sẽ báo **Cần đối chiếu**, giữ thay đổi local. Chọn bản database cần xác nhận và giữ bản sao local với hậu tố `:backup:<timestamp>`; chưa có UI khôi phục bản sao.
- Lưu trên máy trước, đồng bộ khi lưu, khi có mạng trở lại và polling mỗi 30 giây khi trang hiển thị. Chỉ **Đã đồng bộ** xác nhận dữ liệu đã lên server. Chức năng quản trị, phân ca, đề xuất menu và đọc nhật ký cần online; không tạo thành công giả khi mất mạng.
- Thu hồi quyền được áp dụng khi thiết bị nhận cập nhật/online; RPC luôn kiểm tra quyền hiện tại. Cache phục vụ bán hàng offline không thể xóa các bản dữ liệu thiết bị đã từng tải hoặc xuất trước đó. Khi quyền bị thu hồi, UI và server chặn ca không còn quyền; bản pending cũ được giữ để xử lý xung đột, không tự ghi đè.
- Đồng bộ tất cả thiết bị trước khi kết ca. Đơn offline chưa lên có thể xung đột với ca đã chốt; hệ thống giữ dữ liệu, không tự thêm đơn vào ca đóng.
- Snapshot phù hợp quán nhỏ, chưa phân trang; lịch sử lớn cần tách bảng/đồng bộ từng bản ghi. Nhật ký UI giới hạn 500 dòng mới nhất, dữ liệu cũ vẫn nằm trong database.
- Chưa có service worker để mở ứng dụng từ đầu hoàn toàn offline. Xóa dữ liệu trình duyệt sẽ mất phần chưa đồng bộ. Đơn đang soạn chưa bấm lưu là bản nháp tạm thời.

## Xuất dữ liệu cho admin

Vào **Xuất dữ liệu** trong menu admin (trên điện thoại có thể cuộn thanh menu ngang), chọn loại file và bấm tải:

- Danh sách đơn CSV: lọc ngày, ca và trạng thái; có tổng giá trị, doanh thu thực ghi nhận, tiền mặt/chuyển khoản, người tạo/thu/sửa, lý do hủy.
- Chi tiết món CSV: từng món trong từng đơn, số lượng, đơn giá và thành tiền, áp dụng cùng bộ lọc đơn.
- Báo cáo kết ca CSV: doanh thu gốc/đã chốt, điều chỉnh, người kết, tiền thực đếm và chênh lệch; lọc ngày/ca.
- Doanh thu CSV: một dòng cho mỗi ngày/ca, gồm đơn thanh toán/hủy và điều chỉnh. Bộ lọc trạng thái không áp dụng để tránh làm sai số doanh thu.
- Thực đơn CSV: toàn bộ menu hiện tại, bỏ qua bộ lọc ngày/ca/trạng thái.
- Sao lưu POS JSON: toàn bộ menu, đơn, lịch sử sửa và kết ca đang có trên máy, kèm thời điểm xuất/trạng thái đồng bộ. Không chứa thông tin đăng nhập/token, không bao gồm toàn bộ database/Auth/audit/membership của Supabase. Chưa có chức năng tự khôi phục từ file.

CSV dùng UTF-8 BOM, quote đầy đủ các trường có dấu phẩy, dấu nháy và xuống dòng; vô hiệu công thức trong text người dùng khi mở bằng spreadsheet. File lấy từ dữ liệu đang có trên thiết bị; đồng bộ mọi máy trước khi chốt báo cáo chính thức. Ngày trống lấy tất cả; khoảng ngày sai sẽ chặn tải. Xuất dữ liệu không sửa/xóa dữ liệu và không cần migration mới. Nhân viên không có menu hoặc quyền xuất trong ứng dụng.

## Kiểm thử

```sh
npm test
npm run test:db
```

Playwright chạy trên desktop 1440px và điện thoại 390px, dùng API/auth giả lập và không ghi dữ liệu vào dự án thật. Kiểm tra POS, đăng nhập/đăng xuất, offline/retry, conflict, admin/nhân viên, lý do sửa/thu hoàn tiền, hủy, phân ca, đề xuất menu, đối chiếu tiền, báo cáo và Edge Function auth guards. Server test port 5175 tách dev 5173. Cấu hình dùng Chromium hệ thống hoặc `CHROMIUM_PATH`, nếu không có dùng browser Playwright đã cài.

`test:db` dùng Docker/PostgreSQL 17 tạm, không mở cổng host, chạy migrations hai lần và kiểm tra CAS, tổng tiền, role escalation, lọc ca từ DB, chống giả mạo tài khoản thao tác, khóa tài khoản, paid edit, refund/cancel, đề xuất/duyệt menu, đối chiếu và điều chỉnh ca. Không thay thế kiểm tra trên Supabase thật sau khi áp dụng migration và deploy function.

## QR chuyển khoản

`public/payment-qr.svg` là QR minh họa, không phải mã chuyển tiền ngân hàng. Thay file đó bằng QR thật hoặc đổi `PAYMENT_QR` trong `src/main.js` để dùng PNG/JPG; sau khi kiểm tra mã thật, cập nhật nhãn và hướng dẫn trong `.transfer-panel`. QR tĩnh không tự nhúng tiền/nội dung từng đơn. Không có tích hợp ngân hàng/đối soát tự động; nhân viên phải xác nhận tiền đã nhận.

### Mở và đóng ca (migration 003)

Chạy toàn bộ `supabase/migrations/202610180003_staff_shift_sessions.sql` sau migration 002. Chỉ nhân viên được phân công mới được mở và đóng ca; admin xem báo cáo, phân ca và điều chỉnh báo cáo đã kết. Ca có ba trạng thái: chưa mở, đang mở, đã đóng. Phải mở ca trước khi tạo đơn mới; ca đã đóng không mở lại. Database kiểm tra quyền độc lập với giao diện, lưu người và thời điểm mở/đóng ca. Các báo cáo đã kết trước migration vẫn được giữ nguyên.

### Tạm tắt phân ca thủ công (migration 004)

Sau migration 003, chạy `supabase/migrations/202610180004_self_service_shifts.sql`. Admin không còn form phân/gỡ ca; API phân ca thủ công cũng bị chặn. Nhân viên tự mở ca 1–3 trong ngày hiện tại (giờ Việt Nam); hệ thống tự ghi nhận tham gia để giới hạn quyền xem doanh thu/thao tác đúng ca. Quyền và dữ liệu ca cũ được giữ nguyên. Chỉ nhân viên đóng ca; ca đã đóng không mở lại. Mở ca cần kết nối mạng để xác nhận quyền và trạng thái.
