# Lâm An POS

Ứng dụng tính tiền cho quán cà phê, giao diện tiếng Việt, responsive từ điện thoại đến desktop. Vite + JavaScript, không cần backend hoặc tài khoản.

## Chạy dự án

Yêu cầu Node.js 20.19+ hoặc 22.12+.

```sh
npm ci --cache /tmp/npm-cache
npm run dev
```

`npm run build` tạo bản production trong `dist`. `npm run preview` chạy thử bản build.

## Quy trình bán hàng

1. Chọn một trong 3 ca tại Quầy bán hàng.
2. Tạo đơn, chọn số bàn 1–15 hoặc nhập số/tên tùy ý; có thể điền tên khách.
3. Tìm món không dấu hoặc có dấu, chọn món và điều chỉnh số lượng. Không có món thì chọn **Thêm món**, nhập tên và giá.
4. Lưu đơn; mở đơn từ danh sách và xác nhận đã thanh toán.
5. Vào Quản lý ca để kết ca. Cần thanh toán tất cả đơn trước khi kết. Ca đã kết không nhận đơn mới trong ngày.
6. Lịch sử tìm theo số đơn, tên khách hoặc món; lọc ngày và ca. Có thể xuất toàn bộ dữ liệu JSON để lưu trữ.

Ngày kinh doanh tính theo múi giờ Việt Nam. Các ca được chọn thủ công, không giới hạn khung giờ. Báo cáo ngày tổng hợp 3 ca; doanh thu chỉ tính đơn đã thanh toán. Giá trong đơn là giá tại thời điểm tạo, không đổi theo chỉnh sửa menu.

## Dữ liệu

Menu, đơn hàng và báo cáo kết ca lưu trong localStorage (`lam-an-pos-v1`) sau mỗi thao tác xác nhận. Dữ liệu chỉ có trên cùng trình duyệt và địa chỉ web; không đồng bộ giữa máy, và bị mất nếu xóa dữ liệu trình duyệt. Nên xuất dữ liệu thường xuyên. Đơn đang soạn chưa bấm lưu là bản nháp tạm thời. Không có dữ liệu bán hàng giả. Menu khởi tạo theo ảnh người dùng cung cấp; mục ép ổi bị che giá/tên trong ảnh không được tự suy đoán.

## Kiểm thử

```sh
npm test
```

Playwright chạy 6 kịch bản trên desktop 1440px và điện thoại 390px: tạo đơn, số lượng/tổng tiền, lưu qua reload, thanh toán, chặn kết ca khi chưa thu tiền, kết ca, thêm/tìm món, tên bàn tùy ý, lịch sử, phân tách 3 ca và kiểm tra tràn màn hình.

Cấu hình dùng Chromium hệ thống tại `/usr/bin/chromium` trong môi trường cloud. Có thể đặt biến `CHROMIUM_PATH` cho máy khác, hoặc bỏ biến khi không có Chromium hệ thống để dùng browser do `npx playwright install chromium` cài đặt.
