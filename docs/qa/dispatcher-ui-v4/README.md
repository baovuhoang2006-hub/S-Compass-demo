# Dispatcher UI V4 — Comparison modal & Route layout

Nhánh review: `codex/dispatcher-ui-v4-review`.
Nền chính xác: `c05d0a95ac7cf0670f5ebde26658767725efb2a4` trên `codex/dispatcher-ui-v3-review`.
Chỉ làm trong fork `baovuhoang2006-hub/S-Compass-demo`; không tạo PR, merge, deploy hoặc sửa repository gốc.

Tệp yêu cầu nhận được kết thúc giữa mục QA 4, tại “Model predictions and plan”. Đã thực hiện toàn bộ yêu cầu chức năng nhận được, các kiểm tra QA còn đọc được và đầy đủ hồi quy V3; không suy diễn thêm tính năng ngoài phạm vi.

## Kết quả giao diện

### Compare Plans mở một modal

Panel Projected Impact thường trực và hành vi cuộn tới panel của V3 đã bỏ. Generate Proposed Plan tạo Rules draft như cũ, không tự mở modal hoặc dispatch. Compare Plans mở một dialog, dùng comparison cache còn hợp lệ hoặc tính lại bằng hàm hiện có.

Modal dùng cùng Dialog component với Stop Card: giữa màn hình desktop, backdrop mờ, X/Escape và trả focus về nút mở. Trên mobile nội dung cuộn trong dialog. Hiệu ứng vào/ra có sẵn tôn trọng prefers-reduced-motion; không animate số KPI.

Hai card Baseline → S-Compass Rules-based giữ giá trị tính thật, mẫu số, finish, low-chance và scheduled/pending. Mũi tên nhẹ phân biệt trước/sau. Nhãn chính xác “Projected Impact — Simulated Estimates”; giải thích đúng câu trong yêu cầu V4. Các chênh lệch vẫn tính từ số chưa làm tròn, chỉ làm tròn để trình bày.

View Detailed Comparison mở ngay trong cùng modal, không tạo dialog thứ hai. Bảng giữ Baseline/Rules/experimental Model, Logistic Regression prediction riêng, common history-table score, denominator, assumptions và cả ba Use as draft.

Nếu input đổi trong lúc modal mở, số cũ bị ẩn và có Refresh comparison. So sánh mới không âm thầm sửa draft cũ: giao diện vẫn báo nếu draft đang khác phương án vừa so sánh. Buyer Confirm, dispatch guards và replanning dùng nguyên logic V3.

### So sánh an toàn khi thiếu mẫu hoặc chưa xếp hết đơn

Không sửa số gốc, hàm KPI hay thuật toán. Chỉ bổ sung điều kiện **hiển thị chênh lệch**:

- Không tô xanh mức giảm low-chance stops khi một trong hai phương án chưa xếp lịch đủ cùng tập pending; ít stop rủi ro hơn có thể do thiếu đơn đã lên lịch. Raw counts vẫn hiển thị trong từng card.
- Thời gian/đơn và finish không tuyên bố cải thiện khi không so sánh được.
- Chênh lệch expected first attempts chỉ hiển thị khi có cùng mẫu common eligible không rỗng; thiếu hoặc lệch mẫu hiển thị Not comparable cùng lý do.

Đây là các chốt trình bày, không thay đổi công thức hay mẫu số backend. Các giá trị benchmark và kết quả của kịch bản hợp lệ cũ không đổi.

### Route gọn và đặt chi tiết cạnh sơ đồ

Ngay dưới Route heading có ba dòng: HUB → stop đầu → … → stop cuối được lên lịch, chú giải dots/lines/group, và cảnh báo đây là schematic. Stop cuối và FINISH lấy từ plan hiện tại, không hard-code #37. Nếu stop cuối được lên lịch thiếu vị trí hợp lệ, không vẽ FINISH. Chi tiết kỹ thuật thêm nằm trong Route help; bỏ các đoạn giải thích lặp dưới sơ đồ.

Desktop:

- Trái: diagram; cụm N orders · all visits ngay dưới diagram.
- Phải: Selected leg · From → To và Why this stop/time?; Stop sequence ngay bên dưới.

Mobile: diagram → selected leg → cluster list → stop sequence, đúng cả thứ tự đọc/tab của DOM. Chỉ một layout được render ở mỗi breakpoint, không nhân đôi controls. Khi resize, selection và trạng thái Why đang mở vẫn giữ.

Cụm lớn có vùng cuộn bên trong. Cụm mặc định 16 orders đã kiểm tra đủ 16 lượt riêng, ID/sequence/ETA gốc, không đổi hoặc gộp order thật. Chọn lượt hoặc Previous/Next cập nhật selected leg, map, Timeline và Deliveries. Stop sequence/cluster tự cuộn tới lựa chọn mà không cuộn cả trang.

## File thay đổi

| File | Phạm vi |
|---|---|
| `src/app/dispatcher/page.tsx` | Comparison modal, lifecycle và các chốt hiển thị Not comparable |
| `src/components/RouteMap.tsx` | Compact heading/help, layout desktop/mobile, cuộn cluster và giữ selection |
| `docs/qa/dispatcher-ui-v4/` | Báo cáo và ảnh review |

Không đổi `src/lib`, `src/data`, tests cũ, package/lockfile, model weights, Planner sequence/coordinates, dữ liệu lịch sử, workbook, hàm KPI, Buyer/Replanning/Stop Card business functions, Rider, Evidence hoặc Risk Challenge. Không thêm dependency hay giả định số học nghiệp vụ.

## Kiểm thử cuối

| Kiểm tra | Kết quả |
|---|---|
| `npm ci` | PASS, dependency versions giữ nguyên |
| `npm test` | PASS: 41/41, 4 test files |
| `npm run typecheck` | PASS |
| `npm run build` | PASS, 13 static pages |
| 12 rider-day / 439 parcels | PASS, số tham chiếu cũ không đổi |
| Chromium desktop 1440×1100 | PASS |
| Chromium mobile 390×844, reduced motion | PASS |
| Lỗi JavaScript trong walkthrough | 0 |

Cả hai kích thước đã thao tác:

1. Compare khi chưa có draft: đúng một modal, không có panel inline, không tạo hoặc dispatch draft âm thầm.
2. Generate Rules draft; mở/đóng chi tiết; Model prediction vẫn tách khỏi common history-table score; chọn cả ba phương pháp làm draft. Totals so sánh không đổi khi chỉ đổi draft.
3. Cuộn modal, đóng bằng X và Escape, focus về Compare Plans. Chi tiết mở vẫn chỉ một dialog.
4. Đổi rider/shift/buyer commitment: dùng input mới; comparison cũ không hiển thị như hiện tại; reload không tự mở modal.
5. Route neutral lines/selected arrow; time filters và Previous/Next; Why khớp từng reason gốc của PlannedStop.
6. Cụm 16 lượt: đủ ID, thứ tự tăng, không trùng; nội bộ cuộn với chiều cao giới hạn. Chọn lượt cuối đồng bộ selected leg và Deliveries.
7. Đo vị trí thực trong browser: desktop selected leg cạnh trên map, stop sequence ngay dưới selected leg; cluster ngay dưới map bên trái. Mobile đúng thứ tự diagram/leg/cluster/sequence, không tràn ngang toàn trang.
8. Resize qua lại desktop/mobile: giữ selected ID, Why và cụm đang mở.
9. Stop Card main/Advanced, Suggest/Approve/Reject/Verify/Dispute; Rider không có Approve/Reject. Focus/scroll giữ như V3. Snapshot active dispatched plan và mọi buyer response không đổi sau review.
10. Buyer Confirm → pending Replanning chặn dispatch cho cả ba draft methods → Accept → Save Rider outcome → Export Evidence CSV.
11. Risk A/B/C độc lập. Inference hợp lệ trên context demo mới trả `p_success=0.859` (prediction, không phải kết quả giao thực tế).

Kiểm tra bổ sung trong context test cô lập:

- Đổi shift khi modal đang mở để mô phỏng input cập nhật muộn: mất bảng/card cũ, có Refresh comparison, làm mới đúng shift; không dispatch hay tạo draft thay người dùng.
- Bản sao state có ETA không hữu hạn, ETA ngoài buổi và thiếu điểm kết thúc: giữ đủ 37 order trong bảng/sequence; không bịa ETA 00:00, FINISH hay chặng nối qua điểm thiếu.
- Partial scheduling: không hiển thị “5 fewer stops” như một cải thiện low-chance; thay bằng Not comparable.
- Common eligible sample rỗng: expected first-attempt change ghi Not comparable, có lý do. Không sửa dataset gốc hoặc đưa fixture này vào app/ảnh bàn giao.

Walkthrough chạy trên production build **local**, không deploy. Risk A là simulated fault injection, không phải đo tải hạ tầng. Test runner dùng Chromium/Playwright của môi trường QA, không thêm dependency vào repo.

## Ảnh trước/sau

| Nội dung | V3 trước | V4 sau |
|---|---|---|
| Dispatcher desktop | [V3](../dispatcher-ui-v3/dispatcher-desktop.png) | [V4](dispatcher-desktop.png) |
| Comparison | [Inline V3](../dispatcher-ui-v3/impact-details-desktop.png) | [Modal trong trang](comparison-context-desktop.png), [close-up](comparison-desktop.png), [details](comparison-details-desktop.png) |
| Route desktop | [V3](../dispatcher-ui-v3/route-why-desktop.png) | [V4, cụm 16 lượt](route-desktop.png) |
| Dispatcher mobile | [V3](../dispatcher-ui-v3/dispatcher-mobile.png) | [V4](dispatcher-mobile.png) |
| Comparison mobile | — | [Context](comparison-context-mobile.png), [main](comparison-mobile.png), [cuộn xem chênh lệch](comparison-bottom-mobile.png), [details](comparison-details-mobile.png) |
| Route mobile | [V3](../dispatcher-ui-v3/route-why-mobile.png) | [V4](route-mobile.png) |
| Stop Card regression | — | [Main desktop](stop-card-main-desktop.png), [Advanced desktop](stop-card-advanced-desktop.png), [main mobile](stop-card-main-mobile.png), [Advanced mobile](stop-card-advanced-mobile.png) |

Ảnh chỉ dùng fixture demo mặc định đã ẩn danh, không có batch import của người dùng. Ảnh close-up section đặt sticky header thành static riêng lúc chụp để header không che giữa ảnh dài. Ảnh modal/details ghi lại vùng cuộn hiện tại, không giả vờ mọi nội dung đều vừa một màn hình.

## Giới hạn và quyết định cần duyệt

- Mobile vẫn cần vuốt riêng trong diagram và bảng ba phương pháp; toàn trang không tràn ngang. Modal và cluster lớn có cuộn nội bộ.
- Đây là sơ đồ tọa độ ẩn danh. Các lượt trùng hoặc gần tọa độ có thể không thấy đoạn nối ngắn; From → To và sequence là thông tin để đọc chính xác.
- Cần team duyệt kích thước modal, thứ tự mobile và mức rút gọn Route heading/help. Tất cả là lựa chọn trình bày, không đổi dữ liệu hoặc thuật toán.
- Chỉ push nhánh review trong fork cá nhân; chưa tạo PR, merge hoặc deploy.
