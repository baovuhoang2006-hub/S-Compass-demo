# Risk Challenge UI V2 — Fast Review

Ngày kiểm tra: 08/11/2026 (GMT+7).
Nhánh: `codex/risk-challenge-ui-v2-review`.
Base đã xác minh: `release/bce004-final` tại `45d12bcad2742d4fd86adc37c1be01982574f567`.
Chờ user duyệt UI trước Full QA và release integration.

## Phạm vi thay đổi

| File | Thay đổi |
|---|---|
| `src/app/risk-challenge/page.tsx` | Layout inputs/result; status và headline ưu tiên; checks riêng; protected state, next action, fallback; technical disclosure; contextual Evidence buttons; clear kết quả cũ khi đổi input |
| `src/app/risk-challenge/presentation.ts` | Chuyển evidence của Risk engine thành nội dung hiển thị; không lập kế hoạch, chạy model lần hai hoặc sửa state |
| `src/lib/__tests__/riskPresentation.test.ts` | 6 tests cho tính trung thực của presentation, conditional fallback và bảo toàn state |
| `docs/qa/risk-challenge-ui-v2/` | Browser harness, kết quả, logs kiểm thử và 30 ảnh desktop/mobile |

Không thay đổi `riskChallenge.ts`, planner/routing, model/weights, dataset/fixtures, Calculation Sheet, công thức KPI/benchmark, Evidence event handlers, dependencies hoặc các trang đã được duyệt. Không sửa release/main, không PR, merge, force-push hoặc deploy thủ công.

## UX A/B/C

- Status SAFE / REVIEW / TIMEOUT + headline giải thích tình huống ở đầu kết quả; ID chỉ nằm trong phần Evidence mở rộng.
- A: capacity và time-budget checks riêng. Dùng số đã được engine chuẩn hóa; simulated work = parcels × 10 ms. TIMEOUT vẫn ưu tiên khi quá budget, kể cả capacity cùng fail. Ghi rõ đây là mô phỏng, không phải số đo production.
- B: xác suất logistic regression được đổi từ giá trị engine báo cáo sang phần trăm (engine làm tròn 3 chữ số thập phân; ví dụ 0.859 → 85.9%). Không suy diễn đây là đảm bảo giao thành công hoặc confidence. NaN/Infinity không có xác suất giả; 1.25 được ghi rõ là injected invalid output 125%. Missing feature không có output probability. Tách AI output validation và operational rules; không đánh PASS khi chưa có prediction dùng được. Buyer-window conflict phân biệt numeric PASS với operational Failed, ghi rõ commitment được inject là simulated.
- C: cả năm case vẫn REVIEW. Hiện order/site, dữ liệu inject, validation failure, nguy cơ logistics (không phải outcome quan sát), dữ liệu được bảo vệ, action đề xuất và fallback. Giữ −5 minutes, "overnight", morning-only vs evening-only. Giữ hướng xử lý bản ghi gốc khi duplicate. Fallback missing-pin phụ thuộc đúng kết quả engine; không tự áp dụng entrance.
- `Technical details & Evidence` giữ nguyên các giá trị INPUT, DETECTION, EXPLANATION, SAFE ACTION, OUTPUT, FALLBACK, WARNING và incident ID/status từ engine. Chú thích SAFE ACTION/FALLBACK là guidance, không phải thao tác đã thực hiện.
- SAFE dùng `Save test result to Evidence`; REVIEW/TIMEOUT dùng `Record dispatcher review`; AI REVIEW có `Create Rules draft`. Các event `risk_incident_reviewed` và `risk_rules_fallback` giữ nguyên payload/ý nghĩa. Ghi review không đồng nghĩa giải quyết incident; tạo draft không dispatch.
- Đổi input hoặc đổi scenario xóa kết quả hiển thị cũ và hủy timer còn chờ, tránh gắn nhãn input mới vào kết quả trước. Snapshot order/site thuộc đúng lần chạy.

## Fast QA

| Kiểm tra | Kết quả |
|---|---|
| Existing Risk tests | **5/5 PASS** |
| Presentation + state preservation tests | **6/6 PASS** |
| Typecheck cuối | **PASS** |
| A SAFE 20/40/500, REVIEW 60/40/2000, TIMEOUT 100/40/500 | **PASS**, desktop/mobile |
| B valid, NaN, Infinity, above-one, missing feature, buyer conflict | **PASS**, desktop/mobile |
| C tất cả 5 case | **REVIEW**, desktop/mobile |
| Missing-pin: verified entrance và no verified entrance | **PASS**, desktop/mobile |
| Source/plan/buyer commitments/completed stops/Stop Cards unchanged | **PASS**, unit tests và browser state snapshot |
| Evidence review/save, CSV export và Rules draft-only | **PASS**, desktop/mobile |
| Metadata, control edits, processing cancellation | **PASS** |
| JavaScript page errors / horizontal overflow | Không ghi nhận |

Browser dùng Chromium/Playwright, viewport 1440×1000 và 390×844, chạy trên dev server của source mới. Có tạo dispatched plan, ghi outcome thật trong demo và buyer confirmation trước các case; so sánh toàn bộ persisted state trước/sau mỗi scenario. Evidence và fallback được kiểm tra riêng: chỉ thêm event/draft đúng hành động, không đổi active plan hoặc commitments.

Full suite, production build và benchmark **chưa chạy trong Fast Review này**. Sẽ chạy sau khi UI được duyệt, trước integration. Không dùng kết quả build/benchmark của base như chứng nhận bản mới.

```bash
npx vitest run src/lib/__tests__/riskChallenge.test.ts src/lib/__tests__/riskPresentation.test.ts
npm run typecheck
npm run dev -- --port 3025
# Terminal khác trong môi trường QA hiện tại; Playwright có sẵn, không thêm dependency:
NODE_PATH=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules \
  node docs/qa/risk-challenge-ui-v2/browser-qa.cjs
```

Có thể đổi URL bằng `SCOMPASS_QA_URL` và thư mục artifacts bằng `SCOMPASS_QA_OUT`.

[Unit test log](tests.log) · [Typecheck log](typecheck.log) · [Browser results](browser-results.json).

## Ảnh desktop/mobile

| Trạng thái | Desktop | Mobile |
|---|---|---|
| A SAFE | [Ảnh](a-safe-desktop.png) | [Ảnh](a-safe-mobile.png) |
| A REVIEW | [Ảnh](a-review-desktop.png) | [Ảnh](a-review-mobile.png) |
| A TIMEOUT | [Ảnh](a-timeout-desktop.png) | [Ảnh](a-timeout-mobile.png) |
| B valid inference | [Ảnh](b-none-desktop.png) | [Ảnh](b-none-mobile.png) |
| B NaN | [Ảnh](b-nan-desktop.png) | [Ảnh](b-nan-mobile.png) |
| B Infinity | [Ảnh](b-infinity-desktop.png) | [Ảnh](b-infinity-mobile.png) |
| B above-one | [Ảnh](b-above_one-desktop.png) | [Ảnh](b-above_one-mobile.png) |
| B missing feature | [Ảnh](b-missing_feature-desktop.png) | [Ảnh](b-missing_feature-mobile.png) |
| B buyer conflict | [Ảnh](b-hard_conflict-desktop.png) | [Ảnh](b-hard_conflict-mobile.png) |
| C missing pin | [Ảnh](c-missing_pin-desktop.png) | [Ảnh](c-missing_pin-mobile.png) |
| C duplicate ID | [Ảnh](c-duplicate_id-desktop.png) | [Ảnh](c-duplicate_id-mobile.png) |
| C negative time | [Ảnh](c-negative_service-desktop.png) | [Ảnh](c-negative_service-mobile.png) |
| C invalid window | [Ảnh](c-invalid_window-desktop.png) | [Ảnh](c-invalid_window-mobile.png) |
| C conflicting card | [Ảnh](c-conflicting_card-desktop.png) | [Ảnh](c-conflicting_card-mobile.png) |
| C verified entrance fallback | [Ảnh](c-verified-entrance-desktop.png) | [Ảnh](c-verified-entrance-mobile.png) |

Ảnh chỉ dùng demo fixtures. Khi chụp full-page, harness tạm đổi header thành static và ẩn Next dev indicator để không che nội dung; không sửa CSS ứng dụng.

## Xem Preview

1. Mở Vercel project kết nối **baovuhoang2006-hub/S-Compass-demo**.
2. Vào **Deployments**, lọc `codex/risk-challenge-ui-v2-review`.
3. Nếu Git integration đã tự tạo Preview, kiểm tra commit khớp SHA bàn giao và môi trường là **Preview**, rồi chọn **Visit**.
4. Mở **Risk Challenge**, thử A với ba bộ input trên, B với sáu fault options và C với năm anomalies. Mở technical details, ghi Evidence; thử Create Rules draft rồi kiểm tra Dispatcher chưa tự dispatch.
5. Thử trên điện thoại hoặc viewport 390px. Không chọn Promote to Production. Nếu chưa có deployment, báo lại trạng thái thay vì tự deploy trong task này.

Task chỉ push review branch; không gọi Vercel deploy/promote và chưa xác minh URL/trạng thái Preview tự động.

## Giới hạn và lưu ý trước Full QA

- UI adapter đọc các số từ evidence string hiện có để tránh sửa risk engine/API. Nếu format evidence đổi, cần cập nhật adapter cùng tests. Engine hiện chỉ báo probability với 3 chữ số thập phân, UI không giả vờ có thêm độ chính xác.
- Risk B kiểm tra operational constraints ở mức block như engine hiện có, không chứng nhận toàn bộ tuyến hay khả năng phục vụ ngoài những checks đó. Model vẫn experimental; demo role vẫn không phải authentication thật.
- Với input bị từ chối, `Operational delivery rules: Not evaluated` nghĩa là không có output dùng được để đánh giá một đề xuất giao hàng; không khẳng định hard rules đã PASS.
- C không kết nối mutation/quarantine vào Data Intake. Các raw SAFE ACTION dùng câu mệnh lệnh được giữ cho Evidence và có chú thích rõ là đề xuất. Order đã thiếu pin trong fixture có thể hiện thêm lỗi pin cùng anomaly được chọn; không xóa cảnh báo phụ hoặc sửa fixture để chỉ còn một lỗi.
- Local result card không được lưu qua reload như một run riêng; Evidence event chỉ lưu khi operator bấm nút tương ứng, đúng behavior cũ.
- Full-QA harness cũ tìm trực tiếp `Valid inference p_success=...` phải mở `Technical details & Evidence` trước; SAFE dùng nút Save test result to Evidence. Không sửa guard hoặc bỏ assertion để giữ selectors cũ.
