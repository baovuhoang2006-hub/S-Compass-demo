# Stop Cards V2 — QA & review

Nhánh review: `codex/stop-cards-v2-review`.
Nền đã xác minh trên GitHub: `release/bce004-final` tại `b14b51153fda3964fa3450e73592e1e787859014`.
Không tích hợp release/main, tạo PR hoặc triển khai trong task này.

## Thay đổi

- `src/app/stops/page.tsx`: Site Knowledge, giữ 11 site Zone A, card gọn, tìm theo tên trong zone, 5 bộ lọc; thông tin kỹ thuật chuyển vào chi tiết. Liên kết Review requests hỗ trợ di chuyển nhanh tới hàng đợi trên mobile.
- `src/components/KnowledgeReviewQueue.tsx` (mới): một hàng đợi correction, on-site confirmation và dispute; nguồn/actor/thời gian/giá trị cũ/đề xuất/quyết định; lịch sử duyệt theo zone.
- `src/components/StopCardDialog.tsx`: ưu tiên chỉ dẫn Rider, trường thiếu ghi rõ; giữ Advanced Details, toàn bộ quy tắc, thống kê, nguồn, lịch sử. Rider gửi báo cáo; Dispatcher duyệt tại trang Site Knowledge, không có Verify/Approve trực tiếp trong modal.
- `src/app/dispatcher/page.tsx`: bỏ Review Stop Card và modal sửa tri thức; nút tên site chọn order trên tuyến, giữ Knowledge badge, bộ lọc, ETA và Move sang backup. Số correction pending tách khỏi confirmation/dispute; tổng quyết định vẫn gồm tất cả yêu cầu.
- `src/lib/demoState.ts`, `src/lib/knowledge.ts`: tái sử dụng mảng corrections và Evidence; mở rộng loại yêu cầu, snapshot, provenance; guard role trong state; chống duyệt lại và chặn dữ liệu review đã cũ.
- `src/state/DemoProvider.tsx`: khôi phục cờ verificationRequested của browser cũ thành yêu cầu review, không bịa người gửi/thời gian hoặc tạo submission event giả.
- `src/lib/evidence.ts`: nhãn sự kiện mới cho dispute report/rejection và confirmation rejection.
- `src/lib/__tests__/knowledge-review.test.ts` (mới): 11 kiểm thử nghiệp vụ. `logic.test.ts`: kiểm thử weekend closure dùng luồng Rider request → Dispatcher review thay cho Verify trực tiếp đã bị loại bỏ theo yêu cầu.

## Vòng lặp và hành vi an toàn

1. Rider đọc Stop Card, gửi correction, xác nhận tại chỗ hoặc báo tranh chấp. Đây là báo cáo demo trong browser, không phải bằng chứng đã khảo sát thực địa.
2. Card chính thức không đổi khi pending; báo tranh chấp có cảnh báo trên card, modal và hàng đợi. Không tự tạo hard rule hoặc làm yếu ràng buộc đã duyệt từ báo cáo chưa duyệt.
3. Dispatcher xem giá trị cũ, đề xuất, người gửi, thời điểm và nguồn; duyệt/từ chối tại Site Knowledge. Guard ở state ngăn Rider/Buyer gọi quyết định trực tiếp.
4. Khi còn dispute pending, phải xử lý dispute trước khi duyệt yêu cầu khác. Accept dispute đánh dấu card Disputed, giữ nội dung và không sửa tuyến đã dispatch. Muốn xác minh lại, cần quan sát mới rồi Dispatcher duyệt.
5. Hai đề xuất khác nhau cho cùng trường có cảnh báo xung đột. Nếu tri thức thay đổi sau lúc gửi, chặn Approve; yêu cầu từ chối và gửi lại dựa trên thông tin hiện tại. Chủ ý chọn an toàn hơn tự động hòa trộn.
6. Duyệt correction chỉ cập nhật trường và quy tắc được duyệt; không tự nâng các receiving rule khác từ dataset lên hard. Duyệt confirmation là duyệt các chỉ dẫn hiện tại và dataset receiving rules sau khi đọc full card. Quy tắc có nhãn hard/soft riêng.
7. Quy tắc đã duyệt có cùng code với gợi ý dataset được dùng một lần với provenance của correction, tránh gợi ý soft che mất quy tắc được duyệt. Không thay đổi thuật toán planner.
8. Không thay currentPlan, buyer windows, completed stops, outcomes, transfers hoặc proposals từ quyết định review. Người điều phối phải tạo và xem lại kế hoạch mới một cách tường minh.

`version: 3` và localStorage key giữ nguyên; các metadata mới là optional để đọc state cũ. Fixture Verified gốc được giữ nguyên, nguồn vẫn ghi Demo fixture. Pin từ dataset luôn được mô tả là gợi ý, kể cả khi chỉ dẫn dạng chữ đã được duyệt. Review timestamp dùng giờ hệ thống; ngày ca giao vẫn là ngày mô phỏng.

## Kết quả

| Kiểm tra | Kết quả |
|---|---|
| Targeted knowledge/state/planner | PASS: 31 tests khi phát triển, thêm test cùng-code receiving rule sau đó |
| `npm test` cuối | **PASS 52/52**, 5 files (41 cũ + 11 mới) |
| `npm run typecheck` | PASS |
| `npm run build` | PASS, 13 static pages |
| Benchmark | PASS, giữ nguyên 12 rider-day / 439 parcels và các số tham chiếu |
| Browser Stop Cards desktop 1440×1000, mobile 390×844 | PASS, [chi tiết](browser-results.json) |
| Dispatcher V4 / Buyer / Replanning / Rider / Evidence / Risk A-B-C | PASS desktop/mobile, [chi tiết](regression-results.json) |
| AI inference thật | PASS, fixture Risk B không inject fault: `p_success=0.859` cho morning |
| Sample / CSV / XLSX / Column Recognition / capacity / quarantine / Dispatcher / Evidence | PASS, [chi tiết](intake-results.json) |
| JavaScript page errors / tràn ngang trang | Không ghi nhận trong các walkthrough |

Browser Stop Cards kiểm tra: 11 cards, trạng thái, tìm kiếm/empty state, tên dài, Advanced Details, queue rỗng/có dữ liệu; Rider không có nút duyệt; correction pending giữ nguyên thông tin; Dispatcher reject/approve; confirmation pending rồi được duyệt; dispute reject/accept, xác nhận mới giải quyết dispute; snapshot stale bị chặn; reload giữ dữ liệu; tuyến và buyer commitments bằng snapshot trước review; Report issue gửi báo cáo riêng; Record outcome và CSV Evidence chứa đúng events.

Data Intake regression vẫn giữ sample 79 dòng: 68 accepted, 6 warning, 5 quarantined, 74 eligible; R-S1 30 / R-S2 44. Bản gốc hợp lệ không bị loại chỉ vì bản sao bị quarantine; re-attempt ngày khác vẫn eligible. Không đổi parser, fixtures hoặc threshold.

Hai lần chạy harness đầu dừng vì selector QA chưa khớp UI cũ: thiếu bước Send confirmation request và khác hoa/thường Open stop card. Chỉ sửa script; không sửa ứng dụng để chiều theo assertion sai. Lần cuối desktop/mobile đều PASS.

Không cài lại dependencies: package.json và lockfile không đổi. Full suite/build chạy một lần sau khi workflow ổn định. Các targeted tests được dùng trong lúc phát triển.

## Ảnh minh chứng

| Nội dung | Desktop | Mobile |
|---|---|---|
| Trước thay đổi | [Ảnh](before-desktop.png) | [Ảnh](before-mobile.png) |
| Tổng quan mới, queue rỗng | [Ảnh](overview-desktop.png) | [Ảnh](overview-mobile.png) |
| Tên dài (chỉ thay text DOM để kiểm tra bố cục) | [Ảnh](long-name-desktop.png) | [Ảnh](long-name-mobile.png) |
| Advanced Details | [Ảnh](advanced-desktop.png) | [Ảnh](advanced-mobile.png) |
| Rider gửi báo cáo | [Ảnh](rider-reports-desktop.png) | [Ảnh](rider-reports-mobile.png) |
| Queue ở role Rider | [Ảnh](rider-queue-desktop.png) | [Ảnh](rider-queue-mobile.png) |
| Queue ở role Dispatcher | [Ảnh](dispatcher-queue-desktop.png) | [Ảnh](dispatcher-queue-mobile.png) |
| Card sau duyệt | [Ảnh](approved-card-desktop.png) | [Ảnh](approved-card-mobile.png) |

Ảnh chỉ dùng fixture giả danh có sẵn và nội dung bắt đầu bằng Demo/Observed demo do QA nhập; không dùng dữ liệu giao hàng riêng. Với ảnh full-page, harness tạm đặt header về static và ẩn dev indicator để tránh header che card; không đổi CSS ứng dụng. Tên dài chỉ thay trên DOM tạm thời rồi reload, không sửa fixtures/state.

Có thể chạy lại harness tập trung khi server local đang chạy:

```bash
npm run dev -- --port 3015
# Terminal khác, cần Playwright + Chromium của môi trường QA:
NODE_PATH=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules node docs/qa/stop-cards-v2/browser-qa.cjs
```

Dùng `SCOMPASS_QA_URL` nếu chạy cổng khác. Harness tạo browser contexts riêng, không đụng session browser của người dùng. Không thêm Playwright vào dependencies ứng dụng. Báo cáo regression bổ sung là snapshot từ harness của các task trước đã điều chỉnh các assertion Stop Card bị thay thế; luồng mới được kiểm tra bằng script đính kèm ở trên.

## Giới hạn và xem Preview

- Demo role là role selector, không phải authentication hoặc phân quyền server. Không có multi-user syncing hay backend mới. localStorage vẫn là lưu trữ browser, không phải audit log chống chỉnh sửa.
- Không tự retrain model, xác minh GPS/ảnh, tự duyệt hoặc sửa ca đã dispatch. Các trường hợp xung đột cần người điều phối đọc nguồn và quyết định.
- Card Verified có thể chứa các dataset receiving rule còn soft sau một field correction; xem nhãn từng rule và Advanced Details. Không đồng nhất badge cả card với bằng chứng thực địa.
- Yêu cầu legacy thiếu metadata được ghi rõ Not recorded. Không suy diễn người/thời điểm quan sát.
- Tri thức nhận từ report đang chờ chỉ cảnh báo; không tự hủy hoặc reroute. Nếu có rủi ro ngoài thực địa, operator cần dừng thao tác và xử lý thủ công.
- Nhánh review dùng dữ liệu giả có sẵn. Nếu Vercel đã kết nối fork và tự tạo Preview từ push: mở Vercel → đúng project của fork → Deployments → lọc Git Branch `codex/stop-cards-v2-review` → kiểm tra SHA khớp commit bàn giao → deployment loại Preview → Visit. Vào Stop cards, hoặc Generate/Dispatch rồi Rider → Open stop card để thử vòng lặp. Không Promote to Production.
- Task này không truy cập Vercel hoặc xác nhận URL/status Preview. Nếu chưa có Preview, việc tạo deployment cần phê duyệt riêng; chưa tích hợp release cho đến khi người dùng duyệt.
