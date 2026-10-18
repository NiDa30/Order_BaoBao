# Lam An POS

Ứng dụng tính tiền cho quán cà phê, giao diện tiếng Việt, responsive từ điện thoại đến desktop. Vite + JavaScript. Đăng nhập Supabase bằng email/password trước khi vào POS; dữ liệu được cache trên máy và đồng bộ theo tài khoản.

## Chạy dự án

Yêu cầu Node.js 20.19+ hoặc 22.12+.

```sh
npm ci --cache /tmp/npm-cache
npm run dev
```

`npm run build` tạo bản production trong `dist`. `npm run preview` chạy thử bản build.

## Quy trình bán hàng

1. Đăng nhập, rồi chọn một trong 3 ca tại Quầy bán hàng.
2. Tạo đơn, chọn số bàn 1–15 hoặc nhập số/tên tùy ý; có thể điền tên khách.
3. Tìm món không dấu hoặc có dấu, chọn món và điều chỉnh số lượng. Không có món thì chọn **Thêm món**, nhập tên và giá.
4. Lưu đơn; mở đơn từ danh sách, chọn **Tiền mặt** hoặc **Chuyển khoản** và xác nhận đã thanh toán sau khi nhận tiền. Phương thức được lưu cùng đơn và hiển thị trong lịch sử.
5. Vào Quản lý ca để kết ca. Cần thanh toán tất cả đơn trước khi kết. Ca đã kết không nhận đơn mới trong ngày.
6. Lịch sử tìm theo số đơn, tên khách hoặc món; lọc ngày và ca. Có thể xuất toàn bộ dữ liệu JSON để lưu trữ. Mở chi tiết rồi chọn **Sửa đơn** để sửa bàn/tên khách, món, số lượng, đơn giá và ghi chú; chọn **Lưu thay đổi** để cập nhật hoặc đóng để hủy.

Ngày kinh doanh tính theo múi giờ Việt Nam. Các ca được chọn thủ công, không giới hạn khung giờ. Báo cáo ngày tổng hợp 3 ca; doanh thu chỉ tính đơn đã thanh toán. Giá trong đơn là giá tại thời điểm tạo, không đổi theo chỉnh sửa menu. Sửa đơn giữ nguyên mã đơn, ngày, ca và trạng thái thanh toán; đơn cũ được lưu trong lịch sử chỉnh sửa của dữ liệu xuất. Nếu sửa đơn thuộc ca đã kết, doanh thu ca được tính lại, giữ doanh thu gốc và đánh dấu đã điều chỉnh. Việc sửa tổng tiền của đơn đã thanh toán không tự thực hiện thu thêm hoặc hoàn tiền ngoài thực tế.

## Dữ liệu

Menu, đơn hàng và báo cáo kết ca được lưu local sau mỗi thao tác xác nhận. Chưa đăng nhập: chỉ hiện màn hình đăng nhập, không cho xem/tạo đơn, thực đơn hoặc báo cáo. Dữ liệu cũ trong `lam-an-pos-v1` được giữ riêng để nhập sau. Đã đăng nhập: dữ liệu được giữ trong cache riêng theo project + tài khoản và đồng bộ lên Supabase. Chỉ trạng thái **Đã đồng bộ** mới xác nhận bản hiện tại đã lưu lên database. Thay đổi chưa đồng bộ sẽ mất nếu xóa dữ liệu trình duyệt. Nên xuất dữ liệu thường xuyên. Đơn đang soạn chưa bấm lưu là bản nháp tạm thời. Không có dữ liệu bán hàng giả. Menu khởi tạo theo ảnh người dùng cung cấp; mục ép ổi bị che giá/tên trong ảnh không được tự suy đoán.

## Kiểm thử

```sh
npm test
```

Playwright chạy các kịch bản POS trên desktop 1440px và điện thoại 390px: tạo đơn, số lượng/tổng tiền, lưu qua reload, thanh toán, chặn kết ca khi chưa thu tiền, kết ca, thêm/tìm món, tên bàn tùy ý, lịch sử, phân tách 3 ca và kiểm tra tràn màn hình. Bao gồm sửa đơn từ lịch sử, lưu qua reload không tạo bản trùng, giữ metadata thanh toán, cập nhật ca đã kết, hủy sửa và chặn dữ liệu không hợp lệ.

Cấu hình dùng Chromium hệ thống tại `/usr/bin/chromium` trong môi trường cloud. Có thể đặt biến `CHROMIUM_PATH` cho máy khác, hoặc bỏ biến khi không có Chromium hệ thống để dùng browser do `npx playwright install chromium` cài đặt.

## QR chuyển khoản mẫu

`public/payment-qr.svg` là QR minh họa chứa văn bản demo, không phải mã chuyển tiền ngân hàng. Chọn chuyển khoản sẽ hiện QR, số tiền của đơn và nội dung chuyển khoản gợi ý. Quét QR không tự đánh dấu thanh toán; nhân viên phải xác nhận đã nhận tiền.

Để dùng mã thật: thay `public/payment-qr.svg` bằng SVG QR ngân hàng thật, hoặc đổi hằng `PAYMENT_QR` trong `src/main.js` để trỏ tới ảnh PNG/JPG mới trong `public`. Sau đó cập nhật nhãn QR mẫu và hướng dẫn trong `.transfer-panel` khi đã kiểm tra mã thật. QR tĩnh không tự nhúng số tiền/nội dung từng đơn; các thông tin bên dưới ảnh là hướng dẫn nhập cho khách. Chưa tích hợp ngân hàng hoặc xác nhận giao dịch tự động.

Đơn cũ chưa có `paymentMethod` hiển thị “Chưa ghi nhận phương thức”, không tự suy đoán là tiền mặt. Sửa đơn đã thanh toán giữ nguyên phương thức đã ghi nhận.

## Kết nối Supabase

1. Chạy toàn bộ `supabase/migrations/202610180001_pos_workspace.sql` trong **SQL Editor** của dự án Supabase. Migration tạo bảng `pos_workspaces`, hai RPC đọc/lưu, RLS và phân quyền. Chạy lại an toàn, không xóa dữ liệu đang có.
2. Tạo tài khoản bằng **Authentication → Users → Add user** trong Supabase (email + password, xác nhận email theo cấu hình dự án). Không gửi mật khẩu qua chat hoặc ghi vào repo.
3. Copy `.env.example` thành `.env.local`, điền `VITE_SUPABASE_URL` và `VITE_SUPABASE_PUBLISHABLE_KEY` (hoặc `VITE_SUPABASE_ANON_KEY` cho anon key cũ) từ Settings → API Keys. Không dùng service_role, secret key hoặc mật khẩu Postgres trong frontend. File `.env.local` đã được Git bỏ qua.
4. Khởi động lại `npm run dev`. Khi deploy, đặt các biến `VITE_...` tương tự trong build environment của nền tảng deploy rồi build lại; Vite đọc cấu hình ở thời điểm build. Việc kết nối tài khoản Supabase trong công cụ khác không tự tạo các biến này trong repo.
5. Mở ứng dụng sẽ hiện màn hình đăng nhập. Nhập email/password và đợi **Đã đồng bộ** sau khi vào dashboard. Phiên hợp lệ được khôi phục khi reload; đăng xuất quay lại màn hình đăng nhập. Thiếu cấu hình Supabase sẽ chặn truy cập và hiện thông báo liên hệ quản lý, không mở POS local.
6. Nếu có đơn cũ trên máy, chọn **Nhập dữ liệu cũ vào tài khoản**. Chỉ nhập vào tài khoản chưa có đơn/báo cáo ca và chưa sửa menu, tránh ghi đè. Bản local cũ được giữ nguyên. Nếu tài khoản đã có dữ liệu, xuất JSON để đối chiếu trước, chưa tự động gộp lịch sử cũ.
7. Trên thiết bị khác, dùng **cùng tài khoản** để xem cùng dữ liệu. Mỗi tài khoản hiện có workspace riêng; chưa có tính năng nhiều tài khoản nhân viên cùng một quán hoặc phân quyền quản lý/thu ngân.

### Đồng bộ và bảo vệ dữ liệu

- Không mở quyền đọc/ghi cho `anon`. Chỉ user đăng nhập đọc được workspace của chính mình; ghi qua RPC có kiểm tra `auth.uid()`.
- Database lưu JSONB snapshot gồm menu, đơn, chi tiết món, thanh toán, lịch sử chỉnh sửa và kết ca. Đây là thiết kế cho POS nhỏ; chưa phân trang, mỗi lần đồng bộ tải snapshot. Khi lịch sử lớn nên tách bảng và đồng bộ từng bản ghi.
- Mỗi lần ghi dùng revision và transaction để tránh ghi đè giữa các thiết bị. Các đơn độc lập được gộp theo ID; sửa cùng đơn/món/ca từ hai máy sẽ báo **Cần đối chiếu**, không tự chọn bản cuối.
- Có cache và hàng đợi thay đổi bền vững trong localStorage; đồng bộ khi lưu, khi mạng trở lại và mỗi 30 giây khi trang đang hiển thị. Chưa có service worker để khởi động ứng dụng hoàn toàn offline khi chưa tải trang/asset. Chưa dùng Supabase Realtime.
- Trước khi đăng xuất phải đồng bộ hết thay đổi. Đổi tài khoản dùng cache riêng, không tự đưa dữ liệu tài khoản cũ sang tài khoản mới.
- Nếu xung đột, xuất bản trên máy rồi đối chiếu. Nút **Dùng bản trên database** cần xác nhận và giữ bản sao local trước khi thay. Bản sao nằm ở key cache có hậu tố `:backup:<timestamp>`; chưa có giao diện khôi phục bản sao.
- Tổng kết ca được database tính lại từ đơn đã thanh toán; chặn thêm đơn vào ca đã kết, kết ca có đơn chưa thanh toán và thay đổi metadata thanh toán đã ghi nhận. Khi có đơn offline chưa lên server, cần đồng bộ tất cả thiết bị trước khi kết ca. Xung đột kết ca sẽ được giữ để xử lý, không làm mất đơn.

### Kiểm thử Supabase

`npm test` chạy POS, màn hình đăng nhập, đăng xuất, khôi phục phiên, merge và browser contract tests trên desktop/mobile. Các browser tests dùng URL/key giả và mock Supabase API, không gửi dữ liệu test lên dự án thật. Test server ở port 5175, tách khỏi dev server 5173.

`npm run test:db` cần Docker, tạo PostgreSQL 17 tạm, mô phỏng role/auth UID của Supabase rồi chạy migration hai lần và kiểm tra: lưu/đọc, CAS, validation, payment, kết ca, tính lại doanh thu, RLS theo owner và từ chối anon. Không thay thế kiểm tra end-to-end trên Supabase thật.
