# Lam An POS

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
4. Lưu đơn; mở đơn từ danh sách, chọn **Tiền mặt** hoặc **Chuyển khoản** và xác nhận đã thanh toán sau khi nhận tiền. Phương thức được lưu cùng đơn và hiển thị trong lịch sử.
5. Vào Quản lý ca để kết ca. Cần thanh toán tất cả đơn trước khi kết. Ca đã kết không nhận đơn mới trong ngày.
6. Lịch sử tìm theo số đơn, tên khách hoặc món; lọc ngày và ca. Có thể xuất toàn bộ dữ liệu JSON để lưu trữ. Mở chi tiết rồi chọn **Sửa đơn** để sửa bàn/tên khách, món, số lượng, đơn giá và ghi chú; chọn **Lưu thay đổi** để cập nhật hoặc đóng để hủy.

Ngày kinh doanh tính theo múi giờ Việt Nam. Các ca được chọn thủ công, không giới hạn khung giờ. Báo cáo ngày tổng hợp 3 ca; doanh thu chỉ tính đơn đã thanh toán. Giá trong đơn là giá tại thời điểm tạo, không đổi theo chỉnh sửa menu. Sửa đơn giữ nguyên mã đơn, ngày, ca và trạng thái thanh toán; đơn cũ được lưu trong lịch sử chỉnh sửa của dữ liệu xuất. Nếu sửa đơn thuộc ca đã kết, doanh thu ca được tính lại, giữ doanh thu gốc và đánh dấu đã điều chỉnh. Việc sửa tổng tiền của đơn đã thanh toán không tự thực hiện thu thêm hoặc hoàn tiền ngoài thực tế.

## Dữ liệu

Menu, đơn hàng và báo cáo kết ca lưu trong localStorage (`lam-an-pos-v1`) sau mỗi thao tác xác nhận. Dữ liệu chỉ có trên cùng trình duyệt và địa chỉ web; không đồng bộ giữa máy, và bị mất nếu xóa dữ liệu trình duyệt. Nên xuất dữ liệu thường xuyên. Đơn đang soạn chưa bấm lưu là bản nháp tạm thời. Không có dữ liệu bán hàng giả. Menu khởi tạo theo ảnh người dùng cung cấp; mục ép ổi bị che giá/tên trong ảnh không được tự suy đoán.

## Kiểm thử

```sh
npm test
```

Playwright chạy 16 kịch bản trên desktop 1440px và điện thoại 390px: tạo đơn, số lượng/tổng tiền, lưu qua reload, thanh toán, chặn kết ca khi chưa thu tiền, kết ca, thêm/tìm món, tên bàn tùy ý, lịch sử, phân tách 3 ca và kiểm tra tràn màn hình. Bao gồm sửa đơn từ lịch sử, lưu qua reload không tạo bản trùng, giữ metadata thanh toán, cập nhật ca đã kết, hủy sửa và chặn dữ liệu không hợp lệ.

Cấu hình dùng Chromium hệ thống tại `/usr/bin/chromium` trong môi trường cloud. Có thể đặt biến `CHROMIUM_PATH` cho máy khác, hoặc bỏ biến khi không có Chromium hệ thống để dùng browser do `npx playwright install chromium` cài đặt.

## QR chuyển khoản mẫu

`public/payment-qr.svg` là QR minh họa chứa văn bản demo, không phải mã chuyển tiền ngân hàng. Chọn chuyển khoản sẽ hiện QR, số tiền của đơn và nội dung chuyển khoản gợi ý. Quét QR không tự đánh dấu thanh toán; nhân viên phải xác nhận đã nhận tiền.

Để dùng mã thật: thay `public/payment-qr.svg` bằng SVG QR ngân hàng thật, hoặc đổi hằng `PAYMENT_QR` trong `src/main.js` để trỏ tới ảnh PNG/JPG mới trong `public`. Sau đó cập nhật nhãn QR mẫu và hướng dẫn trong `.transfer-panel` khi đã kiểm tra mã thật. QR tĩnh không tự nhúng số tiền/nội dung từng đơn; các thông tin bên dưới ảnh là hướng dẫn nhập cho khách. Chưa tích hợp ngân hàng hoặc xác nhận giao dịch tự động.

Đơn cũ chưa có `paymentMethod` hiển thị “Chưa ghi nhận phương thức”, không tự suy đoán là tiền mặt. Sửa đơn đã thanh toán giữ nguyên phương thức đã ghi nhận.
