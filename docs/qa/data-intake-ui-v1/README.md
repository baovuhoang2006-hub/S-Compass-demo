# Data Intake UI V1 — FAST REVIEW

> Bản điều chỉnh mới nhất: [gom cảnh báo vào từng rider-day card](warning-consolidation.md). Nội dung và ảnh bên dưới ghi lại FAST REVIEW ban đầu trước điều chỉnh. 

Nhánh: `codex/data-intake-ui-review`.
Đã kiểm tra `release/bce004-final` cả local/GitHub trước khi bắt đầu: đúng `0b278bc8afef9b61edc1374fb1699ee491b44588`. Không dùng một HEAD khác, không sửa release/main.

## Thay đổi

- Intro ngắn đúng yêu cầu; toolbar Upload File / Try Sample Data / Download Template / Download Sample CSV / File Requirements.
- File Requirements đóng mặc định, chia Required/Optional/Compatibility/Demo Rules. Ghi rõ chỉ xử lý tối đa 10,000 data rows; các threshold 40 parcels, 300 m, 0–120 phút và HCMC bounding box là demo heuristics, không tự học và không phải ngưỡng thực nghiệm của Calculation Sheet.
- Detected Column Mapping → Show Mapped Columns; giữ nguyên tên cột gốc và internal field. Browser Demo giải thích lưu trong trình duyệt, không nối hệ thống giao hàng live.
- Validation Rules & Safe Fallbacks đóng mặc định và chia nhóm. Bỏ cách gọi validation là AI; sửa lời hứa “Everything is planned / backup rider” thành cảnh báo cần dispatcher review và thao tác transfer rõ ràng. FileNotes gốc giữ nguyên trong batch; heavy-day được trình bày riêng từ shiftInfo thay vì lặp câu gây hiểu sai.
- Kết quả có Rows read, Accepted, Accepted with warning, Quarantined, Eligible for planning, Rider-days và Places. Not processed xuất hiện khi có; phân biệt tổng source rows với phần đã validate, không gọi toàn bộ file là đã xử lý.
- Checked — Not Imported khác Imported — Available in Dispatcher; vẫn bắt buộc bấm Import/Replace.
- Tách Order Issues khỏi Rider-day Warnings; giữ filters, mọi issue text và giới hạn hiển thị 300 issue rows có ghi rõ như cũ. Bảng có vùng vuốt ngang riêng trên mobile.
- Preview trước import: Rider-days Ready to Import; sau import: Imported Rider-days. ID/date/eligible parcels/warning rõ, Open in Dispatcher khóa trước import và dẫn đúng rider-day sau import.

## Phạm vi code

Chỉ sửa `src/app/intake/page.tsx`, cộng báo cáo/ảnh trong thư mục này. Không sửa `src/lib/intake.ts`, importSafety, data/state modules, schema/aliases, mẫu CSV, model, planner, KPI, tests hay dependencies.

Đã đối chiếu chương trình: toàn bộ phần `readFile`, `check`, `onFile`, `doImport`, `open`, `remove` và hành vi khởi tạo state cũ giống từng byte với nền đã duyệt, ngoài một state mới chỉ đóng/mở File Requirements. Quyết định accepted/warning/quarantined, ID/batch generation và localStorage không đổi.

## Kết quả FAST REVIEW đã thực sự chạy

| Kiểm tra | Kết quả |
|---|---|
| `npx vitest run src/lib/__tests__/intake.test.ts` | PASS: 11/11 |
| `npm run typecheck` | PASS |
| Chromium desktop 1440×1000: initial/post-check/import | PASS |
| Chromium mobile 390×844: initial/post-check/import | PASS, không tràn ngang toàn trang |
| Upload File qua file chooser với sample CSV tải xuống | PASS, checked nhưng chưa import |
| Hai nút download, File Requirements, mapping, issue filters | PASS |
| Open in Dispatcher trước/sau import | Khóa trước import; sau import mở đúng R-S2 / ca 44 parcels |
| Check sample lần nữa sau import | Chỉ Checked — Not Imported; Replace là thao tác riêng |
| JavaScript page errors trong walkthrough | 0 |

Sample lấy từ builder hiện có, UI không hard-code các số:

- 79 rows read.
- 68 accepted, 6 accepted with warning, 5 quarantined.
- 74 eligible rows, 2 rider-days: R-S1 30 parcels và R-S2 44 parcels.
- 11 order issues; filter Quarantined hiển thị đúng 5. R-S2 có warning cấp rider-day riêng, không đổi status các dòng R-S2 thành warning.

## Chưa kiểm thử lại trong Phase A

Không chạy npm ci, full npm test, npm run build, benchmark 12 rider-day / 439 parcels hoặc các browser journey ngoài trang liên quan. Không tuyên bố các kiểm tra đó PASS cho task này.

Chưa chạy browser end-to-end XLSX nhiều sheet, file vượt 10,000 rows, toàn bộ replace/remove/reset với plan/buyer/completed stops hoặc hồi quy đầy đủ Dispatcher/Buyer/Rider/Replanning/Evidence/Risk/Model. Mô tả các hành vi này được đối chiếu với code hiện có; targeted tests có coverage của các import safeguards hiện có. Full QA cần được phê duyệt riêng theo Phase C.

## Ảnh trước/sau

- Trước: [initial](before-initial.png), [checked sample](before-checked.png).
- Desktop sau: [initial](initial-desktop.png), [checked sample + warnings](checked-desktop.png), [imported rider-days](imported-preview-desktop.png).
- Mobile sau: [initial](initial-mobile.png), [checked sample + warnings](checked-mobile.png), [imported rider-days](imported-preview-mobile.png).

Ảnh chỉ có fixture fictional, không có dữ liệu người dùng nhập. Close-up preview đặt header static lúc chụp để tránh che ảnh; ứng dụng vẫn dùng header hiện có. Thời gian check là thời gian thật của lần chạy demo, không phải benchmark hiệu năng production.

## Đề xuất riêng và quyết định cần duyệt

Xem [Review & Resolve Quarantined Orders — chỉ đề xuất](quarantine-resolution-proposal.md). Không có chức năng sửa quarantine trong ứng dụng ở commit này.

Cần team duyệt bố cục, cách tách warning theo rider-day và mức chi tiết của File Requirements trước FULL QA. Không merge, tạo PR hoặc deploy; chỉ push nhánh review trong fork cá nhân.
