# Dispatcher UI V3 — báo cáo hoàn tất

Nhánh: `codex/dispatcher-ui-v3-review`.
Nền chính xác: V2 `184694fe522c5a3476ce7caa9926d340ea45b39c`.
Repository: fork cá nhân `baovuhoang2006-hub/S-Compass-demo`.

## Thay đổi và lý do

### Một nơi duy nhất để xem so sánh

Generate Proposed Plan vẫn tạo Rules draft và so sánh từ input hiện tại. Compare Plans trên thanh điều khiển cuộn tới và đưa focus vào Projected Impact. Nếu chưa có kết quả hợp lệ, hành động này tính lại so sánh; không tạo hoặc dispatch một plan thay người dùng.

View Detailed Comparison mở/đóng bảng ngay trong Projected Impact. Bảng giữ đủ Baseline, Rules, Model, mẫu số, assumptions, metadata và prediction Logistic Regression riêng. Ba nút Use as draft giữ nguyên hành động chọn draft; không còn modal so sánh và link lặp từ Draft plan.

Cả tóm tắt lẫn bảng dùng `state.comparison` và `comparisonMeta` hiện có. Dấu vân tay input hiện có xác định khi nào số liệu cũ phải ẩn. Nếu so sánh được làm mới nhưng draft cũ khác phương án hiện tại, giao diện báo rõ để người điều phối chọn draft hoặc tạo plan mới. Baseline/Model được chọn làm draft không làm mất tóm tắt Baseline/Rules của cùng kịch bản.

### Giải thích gọn hơn

Thay panel Methodology & Data Sources bằng một control “How are these estimates calculated?”: ba ý Dataset / Simulated / experimental Model và link How it works. Lịch sử quan sát, mục tiêu case và ước tính vẫn tách rõ. Phần assumptions và denominators chi tiết vẫn có trong bảng mở rộng và tài liệu cũ.

### Stop Card phục vụ việc giao hàng

Main view ưu tiên tên/ID, trạng thái, nguồn ngắn, entrance, handover, receiving windows, access, ba issue đầu trong danh sách hiện có, pending corrections và các hành động. Không lặp tên địa điểm trong nhiều panel.

Advanced Details giữ nguồn đầy đủ, bản ghi xác minh mới nhất, entrance evidence, tọa độ ẩn danh, pin spread khi có, evidence của mọi rule, service time và nguồn của nó, bảng weekday/weekend, toàn bộ issue và counts. Không tạo lịch sử xác minh giả: hành động review trước đó vẫn nằm trong Evidence. Main view phân biệt Verified rule và Unverified recommendation bằng strength hiện có.

Suggest / Approve / Reject / Verify / Dispute và quyền thao tác dùng nguyên business functions cũ. Không tự duyệt hoặc tự thay plan đã dispatch/cam kết buyer.

### Route rõ chặng đang xem

Màu buổi chỉ dùng cho stop/legend. Mọi đường nối thường có màu xám trung tính; chặng đang chọn dùng màu tương phản và arrow. From → To hiển thị số thứ tự, stop ID, ETA, block và địa điểm đích. Chuyển buổi vẫn thuộc một tuyến giao.

Danh sách cụm giữ từng lượt theo sequence và ETA riêng. Nếu hai lượt dùng cùng tọa độ hoặc cùng cụm hiển thị, giao diện giải thích tại sao đường nối ngắn có thể không thấy; không thêm đường hoặc tọa độ giả. Stop thiếu vị trí/ETA vẫn có cảnh báo và nằm trong sequence list.

Why this stop/time? nằm trong selected leg details, dùng đúng reasons, flags, p và pModel có sẵn trong PlannedStop; không thêm lời giải thích AI mới. Panel Why toàn chiều ngang và Open Stop Card lặp đã bỏ; Stop Card vẫn mở từ Deliveries. Với stop đã hoàn tất ở đầu tuyến, không dùng giờ bắt đầu của lần replan để giả thành giờ xuất phát ban đầu.

## File thay đổi

| File | Phạm vi |
|---|---|
| `src/app/dispatcher/page.tsx` | So sánh inline, scroll/focus, nguồn dữ liệu chung, compact methodology, bỏ panel Why lặp |
| `src/components/StopCardDialog.tsx` | Main/Advanced layout; giữ nguyên các hàm nghiệp vụ và quyền |
| `src/components/RouteMap.tsx` | Quy ước màu đường, From → To và Why từ dữ liệu Planner |
| `docs/qa/dispatcher-ui-v3/` | Báo cáo và ảnh review |

Không thay đổi `src/lib`, `src/data`, các bài test có sẵn, package/lockfile, planner, model, weights, công thức KPI, Replanning, Rider, Risk Challenge hoặc các hàm Evidence. Không có giả định số học mới.

## Kết quả kiểm thử

| Kiểm tra | Kết quả |
|---|---|
| `npm ci` | PASS |
| `npm test` | PASS: 41/41, 4 test files |
| `npm run typecheck` | PASS |
| `npm run build` | PASS: 13 static pages |
| Benchmark 12 rider-day / 439 parcels | PASS, tham chiếu cũ không đổi |
| Chromium desktop 1440×1100 | PASS |
| Chromium mobile 390×844, reduced motion | PASS |
| Lỗi JavaScript trong hai walkthrough | 0 |

Cả desktop và mobile đã thao tác:

1. Compare Plans khi chưa có draft: tính so sánh, cuộn/focus đúng Projected Impact, không mở modal và không dispatch.
2. Generate Proposed Plan; mở/đóng detailed table; xem prediction Logistic Regression riêng; chọn Baseline/Rules/Model làm draft. Totals so sánh giữ nguyên khi chỉ đổi draft.
3. Đổi rider, shift và buyer confirmation: số cũ bị ẩn; comparison refresh đúng kịch bản; refresh không thay draft hay active plan âm thầm.
4. Mở Stop Card main và Advanced; xác nhận có source, verification, evidence, bảng đủ ba block và full issue counts; đóng bằng X/Escape, focus quay về đúng nút, giữ scroll bảng.
5. Suggest / Approve / Reject / Verify / Dispute; Rider chỉ gửi đề xuất/on-site confirmation và không có Approve/Reject. Dispatcher review được sau khi đổi role.
6. So sánh state trước/sau review: active dispatched plan và mọi buyer response giữ nguyên.
7. Chọn Route leg, dùng time filters và Previous/Next; mở cụm đủ từng lượt theo thứ tự; Timeline, Route và Deliveries đồng bộ. Các đường không được chọn vẫn trung tính ở mọi filter.
8. Why lấy từng chuỗi reason khớp PlannedStop gốc, không có Open Stop Card lặp.
9. Buyer Confirm → phát sinh Replanning → cả ba phương pháp draft đều bị chặn Dispatch khi proposal còn chờ → Accept new plan → Save rider outcome → Export Evidence CSV.
10. Risk A/B/C chạy độc lập và record dispatcher review. Đây là fault-injection demo, không phải kết quả load test hạ tầng.
11. Reload và mobile không tràn ngang toàn trang; bảng so sánh/sơ đồ có vùng vuốt ngang riêng.

Inference hợp lệ trên context demo mới trả `p_success=0.859`; đây là prediction của model, không phải quan sát giao thực tế.

Browser fixture cô lập bổ sung một ETA không hữu hạn, một ETA ngoài buổi và thiếu điểm kết thúc trong **bản sao state của context kiểm thử**: giữ đủ 37 đơn ở Deliveries/sequence, cảnh báo rõ, không vẽ chặng xuyên qua điểm thiếu, không có ETA 00:00 giả, và KPI thời gian không so sánh được hiển thị Not comparable. Fixture này không được đưa vào app/dataset/ảnh bàn giao.

Walkthrough chạy trên production build local, không triển khai website. Test runner dùng Chromium/Playwright của môi trường QA, không thêm dependency vào project.

## Ảnh trước/sau

| Nội dung | Trước V2 | Sau V3 |
|---|---|---|
| Dispatcher desktop | [V2](../dispatcher-ui-trial-v2/dispatcher-desktop.png) | [V3](dispatcher-desktop.png) |
| Comparison | [Modal V2](compare-modal-before-v2.png) | [Projected Impact](impact-desktop.png), [Inline details](impact-details-desktop.png) |
| Stop Card | [V2](../dispatcher-ui-trial-v2/stop-card-desktop.png) | [Main](stop-card-main-desktop.png), [Advanced](stop-card-advanced-desktop.png) |
| Route / Why | [V2](../dispatcher-ui-trial-v2/route-desktop.png) | [V3](route-why-desktop.png) |
| Dispatcher mobile | [V2](../dispatcher-ui-trial-v2/dispatcher-mobile.png) | [V3](dispatcher-mobile.png) |
| Mobile comparison | — | [Summary](impact-mobile.png), [Details](impact-details-mobile.png) |
| Mobile Stop Card | — | [Main](stop-card-main-mobile.png), [Advanced](stop-card-advanced-mobile.png) |
| Mobile Route / Why | — | [V3](route-why-mobile.png) |

Ảnh chỉ dùng fixture mặc định đã ẩn danh; không dùng batch nhập của người dùng. Ảnh cận cảnh section đặt sticky header thành static riêng khi chụp để tránh header che giữa ảnh dài. Ảnh Advanced cho thấy vùng nội dung đang cuộn; modal vẫn cuộn tới mọi dữ liệu gốc.

## Giới hạn và các lựa chọn cần duyệt

- Route là sơ đồ tọa độ ẩn danh, không phải đường phố; đoạn ngắn trong một cụm có thể khó thấy, vì vậy From → To/sequence là cách đọc chính xác.
- Mobile cần vuốt ngang bảng ba phương pháp và sơ đồ; có hướng dẫn vuốt, không làm tràn toàn trang.
- Main Stop Card hiển thị ba issue đầu; toàn bộ issue/counts còn nguyên trong Advanced. Cần team duyệt mức rút gọn này và thứ tự các phần.
- So sánh mới không tự sửa draft cũ. Khi source/commitment đổi, dispatcher vẫn cần chọn hoặc tạo draft phù hợp rồi review trước dispatch theo safeguards hiện có.
- Đây là nhánh review giao diện. Không tạo PR, merge, deploy hoặc sửa repository gốc.
