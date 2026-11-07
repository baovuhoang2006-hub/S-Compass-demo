# Rider UI V2 — Fast Review

Nhánh: `codex/rider-ui-v2-review`.
Base đã xác minh từ GitHub: `release/bce004-final` tại `1ed3d2352ed2b6ae1a66b4243bb852ed83ff1916`, có Stop Cards V2.

## Phạm vi

Chỉ sửa một file ứng dụng: `src/app/rider/page.tsx`. Các file khác trong thư mục này là báo cáo, harness QA, kết quả và ảnh.

- Next delivery làm nổi bật site, mã đơn, recipient, block, ETA mô phỏng, COD/Prepaid và re-attempt.
- COD ghi Collect cash, đồng thời ghi rõ thiếu số tiền. Schema planner hiện không có trường COD amount hoặc street address đã xác thực: không bịa giá trị hoặc tạo navigation link.
- Hiện entrance/handover, status Stop Card, receiving/access rules và nhãn hard/soft. Pin ẩn danh không được mô tả là cổng đã xác minh. Pickup dùng tên điểm có sẵn khi plan thực sự đã chuyển sang pickup; hướng dẫn của site gốc được ghi rõ.
- Cảnh báo tạm đóng cổng, tranh chấp đang chờ/đã được duyệt và flags từ planner vẫn hiện bên ngoài phần thu gọn.
- Đúng ba primary actions: Open Stop Card / Report Issue ở hàng trên, Record Delivery Outcome toàn chiều ngang bên dưới; touch targets ít nhất 44px.
- Chance và toàn bộ reasons có sẵn nằm trong Why this stop?, mặc định đóng, reset khi chuyển sang đơn tiếp theo. Nhãn history-table estimate phân biệt với model prediction và không bảo đảm kết quả giao.
- Giữ Then, Completed, clock, chọn Next Stop, modal Stop Cards V2, issue/outcome dialogs và mọi handler/state transition cũ. Thêm wrapping cho tên dài và focus ring khi chọn outcome bằng bàn phím.
- Hiện khung giờ buyer đã xác nhận, đọc từ state hiện có; không thay cam kết.

Không sửa `src/lib`, `src/data`, `src/state`, shared components, Dispatcher, Data Intake, Site Knowledge, model, formulas, dataset, fixtures, package.json hoặc lockfile. Không thêm dependency, không đổi event names. Không đổi benchmark assumptions/denominators.

## Kiểm thử

| Nội dung | Kết quả |
|---|---|
| `npm run typecheck` cuối | PASS |
| Rider/planning state targeted tests | PASS 8/8; 13 test không liên quan được bỏ qua có chủ đích |
| Knowledge review state tests | PASS 11/11 |
| Browser desktop 1440×1000 / mobile 390×844 | PASS |
| COD / prepaid | PASS, không bịa amount; prepaid không có yêu cầu thu tiền |
| Empty / Next / Then / Completed / unscheduled | PASS |
| Stop Cards V2 → correction pending | PASS, card và route chính thức chưa đổi; Rider không có Approve |
| Report Issue: wrong info / other / temporary closure | PASS; wrong info mở shared card; closure tạo proposal, không tự sửa tuyến |
| Dispute và closure warnings khi Why đóng | PASS |
| Delivered / Not delivered + failure reason / clock / next selection | PASS |
| Buyer Confirm hiện đúng và không tự sửa route | PASS |
| Evidence CSV | PASS, giữ correction_suggested, dispute_reported, issue_reported, outcome_recorded |
| Keyboard Open Stop Card bằng Enter và trả focus khi đóng | PASS |
| Long names / reload / page errors / tràn ngang trang | PASS; không ghi nhận JavaScript page errors hoặc tràn ngang |

[Chi tiết kết quả browser](browser-results.json).

Commands đã chạy:

```bash
npm run typecheck
npx vitest run src/lib/__tests__/logic.test.ts -t 'keeps completed stops|buyer window change|confirming the already planned|no response never|pickup choice|entrance closed|approved correction|verified weekend closure'
npx vitest run src/lib/__tests__/knowledge-review.test.ts
NODE_PATH=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules node docs/qa/rider-ui-v2/browser-qa.cjs
```

Harness dùng Chromium/Playwright có sẵn, server local `npm run dev -- --port 3015`. Có thể đặt `SCOMPASS_QA_URL` để đổi URL. Dùng browser contexts riêng; chỉ dữ liệu demo và thao tác UI, không sửa fixtures, plan hoặc localStorage để làm test pass. Riêng kiểm tra tên dài chỉ thay text DOM tạm thời rồi reload. Prepaid được kiểm tra bằng plan Baseline và các outcome action thông thường nếu cần đi tới đơn prepaid.

Typecheck lúc phát triển phát hiện tham chiếu trường range không tồn tại; đã dùng helper blockLabel hiện có và typecheck cuối PASS. Harness ban đầu cố click radio sr-only trực tiếp; sửa selector sang label hiển thị, xác nhận radio checked. Không thay outcome logic để chiều theo assertion.

Không chạy npm ci, full suite, production build hoặc toàn bộ benchmark trong Fast Review này. Full QA và benchmark sẽ chạy sau khi người dùng duyệt, trước tích hợp release.

## Ảnh

- Trước: [desktop](before-desktop.png), [mobile](before-mobile.png).
- Sau: [desktop](after-desktop.png), [Next delivery mobile](after-mobile.png).
- [Tên dài mobile](long-names-mobile.png), [Prepaid](prepaid-mobile.png).
- [Stop Card correction pending](stop-card-mobile.png), [Warnings vẫn hiện khi Why đóng](warnings-mobile.png).

Ảnh dùng fixture demo có sẵn và text QA giả. Ảnh mobile sau là crop toàn bộ Next delivery card để thấy đủ ba actions; viewport kiểm thử vẫn là 390×844. Harness tạm đặt header static và ẩn dev indicator khi chụp để header không che nội dung, không sửa CSS ứng dụng. Các trang có nhiều warning/receiving rules cần cuộn để giữ thông tin an toàn.

## Giới hạn và Preview

- Đây vẫn là demo browser, không có street navigation, thanh toán thật hoặc số tiền COD từ nguồn đã xác thực. Giữ nguyên role selector, lưu trữ và workflow được duyệt ở base.
- Không phát hiện blocker trong Fast Review; đây chưa phải kết quả Full QA hoặc xác nhận benchmark mới.
- Vercel: mở project của **fork cá nhân** → Deployments → lọc branch `codex/rider-ui-v2-review` → kiểm tra SHA khớp commit bàn giao → chọn deployment loại Preview → Visit → Dispatcher Generate/Dispatch → Rider.
- Chỉ xem Preview tự tạo nếu integration Vercel đã kết nối. Task này không deploy thủ công và không xác minh URL/trạng thái Vercel. Nếu chưa có Preview, chờ phê duyệt riêng trước khi tạo deployment.
- Chưa tạo PR, merge release/main, sửa repository gốc hoặc promote Production. Chờ duyệt UI rồi mới Full QA/integration.
