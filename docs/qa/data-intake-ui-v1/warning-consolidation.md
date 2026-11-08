# Rider-day warning consolidation — FAST REVIEW adjustment

Tiếp tục trên `codex/data-intake-ui-review`, từ `e0ca597`.

- Bỏ panel Rider-day Warnings riêng; đưa warning vào đúng rider-day card ở cả trạng thái Ready to Import và Imported.
- Sample R-S1: 30 eligible parcels, No capacity warning.
- Sample R-S2: 44 eligible parcels, Capacity review; giải thích vượt demo threshold 40, là cảnh báo cấp rider-day chứ không phải quarantine từng order.
- Warning details giữ thông tin review lịch, transfer cần dispatcher thao tác, không tự phân bổ lại, không đổi row status/eligibility. Ngày và parcel count vẫn hiển thị trong card.
- Giữ Order Issues, filters, Import/Replace/Remove, navigation và mọi validation/fallback/capacity rules. So sánh prefix code với commit nền xác nhận toàn bộ handlers, constants, counters và filters không thay đổi.

Kiểm tra đã chạy:

| Kiểm tra | Kết quả |
|---|---|
| `npx vitest run src/lib/__tests__/intake.test.ts` | PASS: 11/11 |
| `npm run typecheck` | PASS |
| Chromium desktop 1440×1000 / mobile 390×844 | PASS |
| Card R-S1/R-S2, mở/đóng Warning details | PASS |
| Order Issues giữ 11 dòng sample | PASS |
| Trước import Open bị khóa; sau import mở R-S2 đúng ca 44 parcels | PASS |
| Tràn ngang toàn trang / JavaScript errors | Không có |

Không chạy lại full suite, build, clean install hoặc các journey không liên quan. Full QA chưa được thực hiện trong adjustment này.

Ảnh: [desktop](consolidated-preview-desktop.png), [mobile](consolidated-preview-mobile.png). Dùng sample fictional, không dùng dữ liệu người dùng nhập. Close-up chụp riêng card với sticky header đặt static khi capture.

File ứng dụng thay đổi duy nhất: `src/app/intake/page.tsx`. Chỉ push nhánh review cá nhân; không merge/deploy.
