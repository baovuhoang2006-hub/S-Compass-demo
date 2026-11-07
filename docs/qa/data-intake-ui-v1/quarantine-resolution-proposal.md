# Review & Resolve Quarantined Orders — đề xuất READ-ONLY

**Chưa triển khai.** Cần phê duyệt riêng cho thay đổi business logic và chạy Phase B/C.

| Mục | Đề xuất |
|---|---|
| Lợi ích | Dispatcher hiểu nguyên nhân, sửa có bằng chứng và kiểm tra lại, thay vì cố đoán hoặc bỏ qua đơn bị quarantine. Không tự động phê duyệt. |
| Input | Source file/batch version, row number, original headers/values, proposed field patch, lý do và actor. Phải có dữ liệu nguồn thật, không suy ngược giá trị thiếu từ câu lỗi. |
| Validation | Tạo candidate riêng; chạy lại parser/schema/validation hiện có trên toàn batch dự kiến, không chỉ một dòng. Kiểm tra duplicate order ID + delivery date trên toàn phạm vi import; một order ở ngày khác vẫn có thể là re-attempt theo chính sách hiện tại. Chuẩn hóa ID mới, nếu muốn, cần duyệt riêng. |
| Output | Preview before/after, trạng thái và lý do mới cho từng dòng, counts và rider-day diff. Dòng có thể vẫn warning hoặc quarantined. “Validated” không đồng nghĩa “Imported”; áp dụng phải là bước xác nhận riêng. |
| Audit | Link original batch/row và version; lưu field before/after, actor, timestamp, lý do, rule version, kết quả kiểm tra và quyết định apply/reject. Không ghi lại thừa dữ liệu nhạy cảm. Evidence event types và quy trình phục hồi cần thiết kế và test riêng. |
| Rủi ro | Duplicate mới, sửa nhầm danh tính order/attempt, stale batch trong nhiều tab, mất provenance, localStorage quota, làm mồ côi tham chiếu plan hoặc giả kết quả giao. Không sửa dataset thô hay Calculation Sheet. |
| Tests | Valid/invalid correction; duplicate giữa riders; cùng ID ngày khác; thiếu type/rider/location; ngày không hợp lệ; warning vẫn giữ warning; recheck idempotent; stale-version reject; quota failure không báo apply thành công; active plan/buyer/completed/replan/correction/transfer locks vẫn chặn. Sau đó full affected regression và benchmark. |
| Độ phức tạp | Vừa–cao; nên chia 3 PR review riêng: source/provenance context → candidate revalidation/preview → explicit apply, recovery và audit. Chưa chốt lịch thực hiện trước khi duyệt thiết kế lưu nguồn và khóa batch. |

## Blocker thực tế của dữ liệu hiện tại

`ImportBatch.rows` chỉ lưu những dòng có issue dưới dạng `RowResult` (row/order ID/rider/date/status/issues). Nó **không lưu đầy đủ original cells** của mỗi dòng quarantine; vì vậy chưa thể xây editor đáng tin cậy chỉ từ state đang lưu.

Hai hướng cần duyệt: yêu cầu upload lại source file có fingerprint phù hợp, hoặc mở rộng schema để giữ tối thiểu các trường nguồn cần thiết với chính sách privacy/retention. Không tự dựng lại pin, payment, location type hay service time từ issue text.

## Bảo vệ trạng thái đang vận hành

Trước apply, kiểm tra lại batch version và `importUseReason`. Hiện helper này khóa cả draft/comparison, dispatched plan, rider/buyer activity, messages, replans, transfers và Stop Card corrections liên quan. Không lách các khóa này để sửa đơn đã dispatch, hoàn tất hoặc đã được buyer xác nhận.

Phiên bản nhỏ nhất an toàn nên chỉ cho candidate chưa liên quan hoạt động vận hành được import lại sau kiểm tra đầy đủ. Batch đang có hoạt động chỉ được xem/chuẩn bị bản sửa riêng; không cập nhật in-place hoặc đổi receiving window. Evidence export hiện tại là log, không phải bản backup plan có thể restore; recovery phải được thiết kế trước khi hỗ trợ apply thay batch.
