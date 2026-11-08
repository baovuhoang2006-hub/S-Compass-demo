# Dispatcher UI Trial V2 — kết quả kiểm tra

Nhánh review: `codex/dispatcher-ui-trial-v2`. Tiếp tục từ `8bfb727`, là hậu duệ của nền V1 `fe6c6a684277bfca8bd47f377c8422cc09e3dead`. Chỉ làm trên fork `baovuhoang2006-hub/S-Compass-demo`.

## Các phần đã hoàn tất

- Giao diện mới dùng tiếng Anh; không dịch hoặc sửa dữ liệu người dùng.
- Projected Impact tự so sánh Baseline/Rules trên cùng input, mẫu số và điều kiện bắt đầu. Mọi kết quả đều ghi là simulated estimates. Delta lấy từ số chưa làm tròn. Logistic Regression vẫn có cột riêng trong Compare plans.
- Dữ liệu lịch sử có thể mở riêng: 72.7% là kết quả quan sát, 88% là mục tiêu của Proposal. Kết quả của bản nháp là ước tính, không phải thành tích đã đo.
- Thay ba thông tin phụ giả dạng KPI bằng mục mở rộng Methodology & Data Sources; vẫn giữ trang How it works.
- Delivery Schedule toàn chiều ngang, mỗi buổi một hàng, trục giờ tự nhiên, thứ tự stop và ETA gốc. Nhãn gần nhau mở thành danh sách. ETA ngoài buổi và stop chưa xếp lịch có cảnh báo riêng, không ép giờ vào mép trục.
- Route toàn chiều ngang, gồm sơ đồ và danh sách thứ tự. Có All/Morning/Afternoon/Evening, Previous/Next, START/FINISH và danh sách mọi lượt ghé trong cụm. Chỉ tô đậm chặng đang chọn. Không nối xuyên qua stop thiếu vị trí/ETA.
- Timeline/Route/Deliveries dùng chung lựa chọn; bảng cuộn đến stop ngoài vùng nhìn thấy và giữ nguyên cuộn khi đóng modal.
- Giữ Stop Card dạng modal theo yêu cầu bổ sung (thay thế yêu cầu inline trong prompt V2 ban đầu). Suggest/Approve/Reject/Verify vẫn cần thao tác người dùng, không tự dispatch.
- Chuyển động ngắn khi mở phần giải thích/dialog hoặc đổi lựa chọn; không chạy vô hạn, không đếm giả KPI, tôn trọng prefers-reduced-motion. Màu buổi được làm đậm để chữ trắng dễ đọc hơn.

## File thay đổi trong phần tiếp tục

- `src/app/dispatcher/page.tsx`: bố cục, nguồn dữ liệu, chọn/hiện stop, thống nhất nút tạo plan.
- `src/components/RouteMap.tsx`: lọc buổi, sequence list, cụm, chọn chặng và START/FINISH.
- `src/components/ShiftRibbon.tsx`: Timeline responsive, nhãn thời gian và cảnh báo.
- `src/components/bits.tsx`: màu buổi và kiểm tra ETA khi hiển thị.
- `src/components/ui/dialog.tsx`: trả focus và hiệu ứng dialog.
- `src/app/globals.css`: chuyển động nhẹ, reduced motion và màu buổi.
- `src/lib/routePresentation.ts`: biến đổi chỉ phục vụ hiển thị, không chạy tối ưu hóa.
- `src/lib/__tests__/routePresentation.test.ts`: bốn kiểm thử bảo toàn dữ liệu khi hiển thị.
- Thư mục báo cáo này: ảnh và bằng chứng QA.

## Lỗi giao diện đã xác nhận và sửa

1. Dialog mở bằng nút ngoài DialogTrigger có thể trả focus về body sau Escape. Giờ trả focus đúng nút mở và không cuộn trang.
2. ETA không hữu hạn được lưu thành null trong JSON có thể hiển thị 00:00 ở nhãn giao hàng sau refresh. Nhãn giờ giờ kiểm tra Number.isFinite và ghi Unscheduled; không sửa thuật toán hoặc giá trị ETA.
3. Nhãn START/FINISH có thể bị cụm điểm che. Giờ dùng nhãn riêng kèm đường chú thích tới vị trí thật.
4. Nút tạo plan trong empty state trước đây bỏ qua so sánh tự động. Giờ dùng cùng hành động Generate Proposed Plan với nút chính.

## Kiểm thử

| Hạng mục | Kết quả |
|---|---|
| `npm ci` | PASS; không đổi package.json/lockfile |
| `npm test` | PASS: 41/41, 4 file test |
| `npm run typecheck` | PASS |
| `npm run build` | PASS; 13 trang static |
| Benchmark 12 rider-day / 439 parcels | PASS, số tham chiếu cũ giữ nguyên |
| Chromium desktop 1440×1000, mobile 390×844 | PASS, không tràn ngang toàn trang |
| Historical/target/methodology | PASS, nguồn và ý nghĩa tách rõ |
| Tạo Rules → Projected Impact → Compare plans | PASS; Logistic Regression có prediction riêng |
| Đổi rider/shift, xác minh Stop Card | PASS; không trình bày comparison cũ như hiện tại |
| Lọc Route, Previous/Next, chọn cụm và Timeline +N | PASS, chọn đúng stop trong Deliveries |
| Suggest/Approve/Reject/Verify Stop Card | PASS; không tự dispatch |
| Escape, trả focus, giữ scroll của bảng | PASS |
| Buyer Confirm → guarded Dispatch → accept Replanning | PASS |
| Rider: Save outcome → Evidence: Export CSV | PASS |
| Risk A/B/C; inference hợp lệ; fault injection | PASS; inference hợp lệ mẫu trả p_success=0.859 |
| Refresh và reduced motion | PASS |
| Lỗi JavaScript trong walkthrough | 0 |

Bài kiểm thử presentation mới xác minh: không vẽ chặng giả qua điểm thiếu; bỏ qua tọa độ/ETA không hữu hạn; phân loại ETA ngoài buổi; không mất hoặc nhân đôi lượt ghé khi gộp nhãn trên mobile.

Một browser fixture cô lập đã sửa bản sao state demo trong context kiểm thử để tạo một stop chưa xếp lịch, một ETA ngoài buổi và một điểm kết thúc thiếu vị trí. Kết quả: giữ đủ 37 đơn trong cả bảng lẫn danh sách tuyến; cảnh báo rõ; không vẽ chặng xuyên qua điểm thiếu; thời gian/đơn ghi Not comparable; không hiển thị 00:00 giả. Fixture không được đưa vào app hoặc dữ liệu chuẩn, ảnh bàn giao dùng fixture demo gốc.

Walkthrough chạy trên cả dev server và bản production build **chạy local**; không deploy ra ngoài. Không sửa planner.ts, model.ts, kpi.ts, demoState.ts, dataset, benchmark hoặc model weights trong phần tiếp tục này.

## Ảnh review

- [Dispatcher V1 trước thay đổi](dispatcher-before-v1.png)
- [Dispatcher V2 sau thay đổi](dispatcher-desktop.png)
- [Projected Impact](projected-impact.png)
- [Historical và Methodology mở rộng](history-and-methodology.png)
- [Timeline desktop](timeline-desktop.png)
- [Route desktop](route-desktop.png)
- [Stop Card inline trước thay đổi](stop-card-before-inline.png)
- [Stop Card modal desktop](stop-card-desktop.png)
- [Dispatcher mobile](dispatcher-mobile.png)
- [Timeline mobile, cụm đã mở](timeline-mobile.png)
- [Route mobile](route-mobile.png)
- [Stop Card mobile](stop-card-mobile.png)

Ảnh chỉ dùng dữ liệu demo mặc định đã ẩn danh, không có batch người dùng nhập. Ảnh cận cảnh section đặt sticky header thành static riêng lúc chụp để tránh header che giữa ảnh dài; không thay đổi nội dung. Ảnh modal desktop dùng chiều cao 1300 px để thấy đủ các hành động; ở màn hình thấp hơn nội dung cuộn bên trong dialog.

## Giới hạn và quyết định để duyệt

- Route vẫn là sơ đồ từ tọa độ ẩn danh. Đường thẳng không đại diện đường phố hay giao thông thực tế.
- Trên mobile, sơ đồ có vùng vuốt ngang để nhãn đọc được; danh sách thứ tự và ETA nằm ngay dưới. Đây là cách xem chính xác hơn khi nhiều lượt giao trùng tọa độ.
- Cụm Route có thể chứa các điểm gần nhau từ nhiều địa điểm. Nhãn N orders chỉ phục vụ trình bày; mở cụm để xem từng đơn/lượt ghé. Không gộp dữ liệu hay thay thứ tự Planner.
- Sau duyệt thông tin làm đổi ràng buộc, người điều phối cần tạo và review plan mới. Plan đã dispatch và khung giờ buyer không tự đổi. Các dispatch safeguards hiện có giữ nguyên theo phạm vi task.
- Cần chủ dự án duyệt bố cục Schedule → Deliveries → Route, màu buổi đậm hơn, và cách vuốt sơ đồ trên mobile trước khi merge/deploy. Nhánh này chỉ để review; chưa merge/deploy.
