# Buyer Simulation V2 + Replanning V2 — review QA

Nhánh review: `codex/buyer-replanning-v2-review`.
Base đã xác minh từ GitHub: `release/bce004-final` tại `32e8a22e449826976034693615cbb1f81862775b`.
Chưa merge release/main, tạo PR hoặc deploy.

## File thay đổi và hành vi

| File | Thay đổi |
|---|---|
| `src/lib/demoState.ts` | Guard Dispatcher cho quyết định; snapshot và kiểm tra proposal trước acceptance; validate pending order, window, pickup cùng zone; mô phỏng có provenance; giữ cảnh báo khi override |
| `src/lib/replan.ts` | Metadata review/supersession; resolve tên đích từ từng plan; bộ đếm change thêm thay đổi vị trí/đích, giữ threshold ETA 15 phút có sẵn |
| `src/lib/evidence.ts` | Thêm nhãn `demo_scenario_triggered`, `replan_superseded`; không xóa event cũ |
| `src/components/ProposalReview.tsx` | Tóm tắt trước/sau, chi tiết thu gọn; Buyer/Rider chỉ xem; Dispatcher quyết định; shared follow-up warning |
| `src/app/replan/page.tsx` | Giữ bố cục sidebar/nội dung, gom ba scenario trong Simulate a scenario; chỉ order pending và pickup cấu hình của zone |
| `src/app/buyer/page.tsx` | Dùng chung feasibility; pending selection nhất quán; đích trong header đọc từ plan; pickup rỗng/không hợp lệ có thông báo; hiện follow-up |
| `src/app/rider/page.tsx` | Chỉ thêm shared follow-up warning; giữ Rider UI V2 và các action |
| `src/app/dispatcher/page.tsx` | Chỉ thêm shared follow-up warning; giữ Dispatcher V4 |
| `src/lib/__tests__/replanning-review.test.ts` | 19 tests tập trung cho permission, dữ liệu, integrity và presentation |
| `docs/qa/buyer-replanning-v2/` | Báo cáo, browser harness, kết quả và ảnh |

Không sửa planner/routing algorithm, model weights, success table, raw/dataset fixtures, knowledge review state, persistence, dependencies hoặc công thức KPI. Dữ liệu và các file thuật toán được đối chiếu byte-for-byte với base. Chưa chạy lại toàn bộ benchmark ở bước review này.

## Permission và safety gates

- Chỉ Dispatcher có Accept new plan / Keep current plan. Buyer/Rider giữ thông tin read-only trong shared component. Direct calls `decideProposal` của Buyer/Rider trả về state cũ, không sửa route, history hoặc Evidence.
- Acceptance kiểm tra selected shift, current plan, snapshot input, pending/complete state, tập ID không mất/trùng/thêm, completed route entries, buyer commitments, hard site restrictions, valid pickup destination và pickup probabilities phải là no-data.
- Snapshot thay đổi sau outcome, clock, buyer commitment, approved knowledge hoặc plan mới: khóa Accept, yêu cầu proposal mới. Không ghi đè state mới hoặc tự refresh/accept.
- Những order chủ động được hold/unplanned vẫn có trong plan, có flags và không có ETA giả. Buyer commitment không thể đáp ứng sẽ chặn acceptance. Capacity warning hiện rõ để Dispatcher xem; không biến mọi gợi ý/nhãn time block thành một hard rule mới.
- Override cần note trong cả UI và state. Buyer request/closure vẫn được giữ; cảnh báo và follow-up hiện ở Replanning, Buyer, Rider, Dispatcher đến khi current route đã đáp ứng hoặc order được xử lý.
- Re-invite hoặc no-response không xóa commitment/pickup đã nhận. Invalid pickup ID, sai zone, tọa độ không hợp lệ, order không tồn tại/đã hoàn thành và khung giờ không khả thi không được áp dụng.
- Trạng thái `superseded` tách khỏi `overridden`. Proposal cũ và ID thay thế được giữ; các trường hợp legacy có note Replaced/Superseded được hiển thị đúng mà không sửa lịch sử gốc.
- Simulated operator event được ghi trước Buyer/Rider event; system-generated proposal không được mô tả như quyết định của Dispatcher. Quyết định có role Dispatcher, thời gian và proposal ID. Demo role được phục hồi sau simulation.
- Stop Cards V2 không đổi workflow: pending correction vẫn chờ Dispatcher, temporary closure không tự duyệt permanent knowledge.

## Ba scenario

1. **Buyer đổi receiving window**: chỉ lựa chọn khả thi theo clock và hard rules. Dùng `buyerChange`; current route giữ nguyên đến khi Dispatcher duyệt.
2. **Buyer chọn pickup**: dùng đúng `buyerPickup` và planner cũ. Chọn pending order trong ca, pickup point của zone; hiện tên/hours có sẵn. Input thiếu hoặc sai có placeholder/disabled action, không tạo pickup giả. Ước tính thành công pickup vẫn no-data.
3. **Entrance unavailable**: dùng `reportEntranceClosed`; kiểm tra alternate/timestamp có thể dùng. Closure giữ tính chất incident tạm thời, không phải correction đã duyệt.

Buyer Simulation và Rider Report Issue vẫn là entry points độc lập vào cùng các hàm. Buyer có thể chọn pickup hợp lệ khi không có receiving window khả thi; không cần bịa một offered window để gửi request.

Summary hiển thị order, before/after destination, vị trí trong remaining route, ETA mô phỏng, các order khác bị tác động và commitments/capacity warnings. Previous/proposed sequence, reasons và commitments đầy đủ ở disclosure. Tên pickup được resolve bằng `pointSource` + point của từng plan; không lấy buyer state mới nhất để đổi tên đích trong lịch sử. Phone header sau acceptance cũng hiển thị đúng pickup destination; original site vẫn được ghi riêng.

## Kiểm thử đã chạy

| Nhóm | Kết quả |
|---|---|
| Replanning workflow/state/presentation | **19/19 PASS** |
| Stop Cards V2 knowledge review | **11/11 PASS** |
| Risk safety logic | **5/5 PASS** |
| Rider/Buyer/planner targeted regression | **8/8 PASS**, 13 test khác được bỏ qua có chủ đích |
| Tổng focused tests | **43 PASS** |
| `npm run typecheck` cuối | **PASS** |
| 3 scenario + role guards trên desktop 1440×1000 / mobile 390×844 | **PASS** |
| Actual Buyer window/pickup/no-response; Rider issue/outcome; pending Stop Card review | **PASS** |
| Stale snapshot, override warnings, superseded history, CSV Evidence | **PASS** |
| Imported rider không có pickup point | **PASS**, disabled action và thông báo đúng; không crash |
| JavaScript page errors / tràn ngang trong scenarios chính | Không ghi nhận |

Kết quả browser: [browser-results.json](browser-results.json).

Commands:

```bash
npx vitest run src/lib/__tests__/replanning-review.test.ts src/lib/__tests__/knowledge-review.test.ts src/lib/__tests__/riskChallenge.test.ts
npx vitest run src/lib/__tests__/logic.test.ts -t 'keeps completed stops|buyer window change|confirming the already planned|no response never|pickup choice|entrance closed|approved correction|verified weekend closure'
npm run typecheck
```

Browser dùng Chromium/Playwright có sẵn, không thêm dependency:

```bash
npm run dev -- --port 3015
# Terminal khác trong môi trường QA hiện tại:
NODE_PATH=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules node docs/qa/buyer-replanning-v2/browser-qa.cjs
```

Dùng `SCOMPASS_QA_URL` để đổi URL. Harness dùng contexts riêng và các thao tác UI; không sửa fixtures/state để làm test pass. Các test empty/invalid configured points dùng mock in-memory được restore trong unit tests; browser dùng rider import từ sample có sẵn. Không fake field inspection hoặc gửi tin nhắn ngoài app.

Full suite, production build, toàn bộ benchmark 12 rider-days / 439 parcels và Full QA sẽ chạy **sau khi user duyệt UI**, trước integration; không thực hiện lặp lại trong task review này.

## Ảnh desktop/mobile

| Nội dung | Desktop | Mobile |
|---|---|---|
| Buyer đổi window, read-only role Rider | [Ảnh](window-desktop.png) | [Ảnh](window-mobile.png) |
| Pickup before/after, read-only role Rider | [Ảnh](pickup-desktop.png) | [Ảnh](pickup-mobile.png) |
| Closure, read-only role Rider | [Ảnh](closure-desktop.png) | [Ảnh](closure-mobile.png) |
| Dispatcher review pickup | [Ảnh](dispatcher-pickup-desktop.png) | [Ảnh](dispatcher-pickup-mobile.png) |
| Actual Buyer read-only | [Ảnh](buyer-readonly-desktop.png) | [Ảnh](buyer-readonly-mobile.png) |
| Keep current plan + follow-up | [Ảnh](follow-up-desktop.png) | [Ảnh](follow-up-mobile.png) |
| Stale proposal sau outcome | [Ảnh](stale-desktop.png) | [Ảnh](stale-mobile.png) |

[Imported rider thiếu pickup](empty-pickup-mobile.png) · [Buyer destination sau pickup acceptance](buyer-accepted-pickup-mobile.png).

Ảnh chỉ dùng fixture/sample giả danh và text QA bắt đầu bằng Demo. Header tạm static và dev indicator tạm ẩn khi chụp full-page để tránh che nội dung; không đổi CSS ứng dụng.

## Giới hạn / phần cần duyệt

- Đây là prototype trong browser. Demo role không phải authentication hoặc audit log chống chỉnh sửa; không có backend/multi-user synchronization mới.
- Legacy open proposal không có safety snapshot không thể Accept trực tiếp. Operator cần tạo một proposal mới; lịch sử cũ được giữ và labelled Superseded. Không reset browser state tự động.
- Stale proposal không được tự trộn với input mới. Operator phải tạo/review proposal mới; đây là trade-off bảo toàn commitments và completed stops.
- Pickup opening hours hiện là text cấu hình hiển thị cho operator; chưa bổ sung bộ phân tích opening hours hoặc enforce một mô hình giờ mới. Phải kiểm tra hours khi review. Không có dữ liệu để suy luận pickup success uplift.
- Temporary closures tiếp tục dùng overlay demo có sẵn, Reset demo xóa overlay; task không bổ sung hệ thống quản lý incident nhiều ca ngoài demo.
- Capacity warnings vẫn cần Dispatcher xem; hard constraints/buyer commitments vi phạm bị chặn. Không sửa thuật toán để làm cho mọi scenario đều có plan khả thi.
- Các harness QA cũ có bước Rider tự Accept phải được điều chỉnh sang Dispatcher khi chạy Full QA phiên bản này; không khôi phục quyền duyệt sai chỉ để giữ assertion cũ.

Vercel Preview: mở project của **fork cá nhân** → Deployments → lọc branch `codex/buyer-replanning-v2-review` → kiểm tra SHA khớp commit bàn giao → chọn deployment loại Preview → Visit. Thử Dispatcher Generate/Dispatch → Replanning → Simulate a scenario, đổi role để kiểm tra read-only/decision. Task này chỉ push review branch; chưa gọi Vercel/deploy thủ công hoặc promote Production, chưa xác minh URL/status Preview. Chờ user duyệt trước Full QA và merge release.
