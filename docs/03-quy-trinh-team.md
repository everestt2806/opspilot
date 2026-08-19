# QUY TRÌNH TEAM 2 NGƯỜI

Đủ dùng, không "scrum kiểng". Mục tiêu duy nhất: **cả hai người đều trả lời được về toàn hệ
thống lúc bảo vệ** — hội đồng hay cố tình hỏi người không viết phần đó.

---

## 1. Git

**Trunk-based đơn giản:** nhánh `main` luôn chạy được. Mỗi việc một nhánh ngắn
`feat/<module>-<viec>`, sống tối đa **3 ngày**, merge bằng PR.

- Prefix commit theo module: `[ssh] [crypto] [db] [detector] [deploy] [migrate] [monitor]
  [ml] [ui] [exp] [infra] [docs]`
  → `[deploy] them buoc HEALTHCHECK va tu rollback`
- Commit message tiếng Việt không dấu, thể mệnh lệnh, ≤72 ký tự dòng đầu.
- **Tag mốc:** `v-w3-deploy-ok`, `v-w4-mvp-67`, `v-w8-freeze`, `v-w9-data-done` —
  quay lại trạng thái từng milestone khi cần.
- Không force-push lên `main`. Không commit trực tiếp lên `main` (trừ sửa docs và **initial
  commit duy nhất** khi repo chưa có commit nào).

**Review PR:** người kia đọc lướt trong **24 giờ**. Mục tiêu là *nắm code của nhau*, không
phải soi lỗi. Checklist review: [`prompts/99-review.md`](prompts/99-review.md).

**Quy tắc vàng:** không hiểu code trong PR (kể cả code AI viết) → **không approve**. Hỏi cho
đến khi hiểu. Đây không phải khách sáo — đây là chuẩn bị cho câu hỏi phản biện.

### Tài khoản và credential Git

- Dùng **một repo private chung**, mời cả hai tài khoản làm collaborator. Không tách code A/B
  thành hai repo vì contract, migration và smoke test cần được kiểm tra trên cùng một `main`.
- Mỗi người clone repo bằng tài khoản của mình và cấu hình `user.name`/`user.email` trên máy
  của mình. Không chia sẻ token, mật khẩu hay private SSH key Git.
- Nếu A làm thay phần của B khi B bận, A vẫn commit bằng danh tính của A với prefix đúng module
  như `[ml]` hoặc `[monitor]`. Không đổi author thành B và không dùng credential của B.
- Nếu thật sự cần hai tài khoản Git trên cùng một máy, dùng hai SSH key + hai host alias và hai
  clone riêng; mỗi clone cấu hình identity cục bộ. Đây chỉ là phương án vận hành, không tạo repo thứ hai.

### Quản lý task

- **Repo là nguồn sự thật cho task/trạng thái**: [`tasks/README.md`](tasks/README.md) (quy
  trình) + [`tasks/board.md`](tasks/board.md) (bảng tổng) + `tasks/tk-*.md` (hồ sơ từng task).
  GitHub vẫn là nguồn sự thật cho code/test/merge. Không dùng GitHub Issues.
- Luồng task: `TUẦN NÀY → ĐANG LÀM → CHỜ REVIEW → HOÀN THÀNH`; vướng trên 30 phút thì
  `BLOCKED` và ghi rõ điều kiện gỡ chặn.
- Mỗi người tối đa một task `ĐANG LÀM`. Push commit chưa phải hoàn thành; phải có PR mới sang
  `CHỜ REVIEW`, và chỉ sang `HOÀN THÀNH` sau khi PR merge vào `main` cùng test pass.
- Hồ sơ tk phải ghi owner, deadline, branch, vùng file được sửa/không sửa và Definition of Done.
  Playbook hằng ngày và mẫu nhật ký cho AI: [`tasks/README.md`](tasks/README.md).
- Khi giao một task cho AI, dùng [`prompts/01-task-from-board.md`](prompts/01-task-from-board.md).
  **AI phải tự cập nhật board + tk-file trước khi bàn giao**; con người vẫn chịu trách nhiệm
  xác nhận test và quyết định merge.

---

## 2. Nhịp làm việc

| Khi nào | Việc | Thời lượng |
|---|---|---|
| Thứ Hai đầu giờ | Đối chiếu [`04-timeline.md`](04-timeline.md), cập nhật cột "Thực tế", chốt việc tuần | 15 phút |
| Thứ Hai | Mỗi người giải thích cho người kia **1 đoạn code AI viết tuần trước** | 5 phút/người |
| Bất cứ lúc nào có quyết định lệch kế hoạch | Ghi 1 dòng vào [`../DECISIONS.md`](../DECISIONS.md) | 1 phút |
| Thứ Sáu | 1 người chạy [smoke test 10 phút](15-checklists.md#smoke-test-10-phút) trên `main` | 10 phút |
| Cuối tuần chẵn | Review [`13-so-rui-ro.md`](13-so-rui-ro.md) | 10 phút |

Smoke test fail → **tuần sau ưu tiên sửa trước khi làm việc mới**. Không tích nợ.

---

## 3. Phân công & ranh giới

Từ 15/08/2026, nhóm dùng phân công **A = Core/Algorithms, B = UI/Delivery**. Bản đầy đủ và
timeline bàn giao nằm tại [`20-phan-cong-a-core-b-ui.md`](20-phan-cong-a-core-b-ui.md); quy
trình theo dõi task nằm tại [`tasks/README.md`](tasks/README.md).

| | Người A — Core/Algorithms | Người B — UI/Delivery |
|---|---|---|
| Sở hữu | `app/src/main/**`, `ml-service/**`, `templates/**` | `app/src/renderer/**`, `collector/**`, `demo-apps/**`, `experiments/**` |
| Báo cáo | Kiến trúc, core app/infra, monitoring và thuật toán ML | UI/UX, collector, kịch bản demo, thực thi thí nghiệm và hình/bảng kết quả |
| Không đụng vào của nhau | trừ bug chặn đã ghi trong tk-file/PR | trừ bug chặn đã ghi trong tk-file/PR |

**Ranh giới chung là `app/src/shared/**`, `docs/contracts/**`, migration và giao thức thí
nghiệm.** Ai muốn đổi contract phải báo người kia **trước khi** code, vì phía bên kia đang
code theo phiên bản cũ. B dựng UI bằng fixture/mock đúng type; A cung cấp handler thật sau.

---

## 4. Quy tắc dùng AI

Để giải trình phần "AI hỗ trợ" một cách tự tin trước hội đồng:

1. **AI code theo spec, người quyết định spec.** Mọi quyết định thiết kế nằm trong
   `docs/`, do người viết ra, không do AI đề xuất giữa chừng.
2. **Người merge phải giải thích được từng hàm public làm gì.** Không hiểu → không merge.
3. Mỗi tuần mỗi người chọn 1 đoạn code AI viết, giải thích lại cho người kia (mục 2).
   Đây chính là buổi tập trả lời hội đồng, làm 12 lần trước khi bảo vệ.
4. Không để AI tự ý: đổi interface · thêm dependency · đổi tên bảng/cột · thêm tính năng
   ngoài spec · "refactor cho gọn" file người khác đang sửa.
5. Ghi lại trong `DECISIONS.md` mọi lần AI đề xuất một cách làm khác và nhóm **chấp nhận** —
   kèm lý do. Đó là bằng chứng nhóm có phán xét, không chỉ dán code.

**Câu trả lời chuẩn khi hội đồng hỏi "AI làm bao nhiêu phần?":**
> "AI viết phần lớn code theo spec do nhóm em thiết kế. Toàn bộ kiến trúc, contract giữa các
> module, giao thức thí nghiệm và cách xử lý kết quả là do nhóm em quyết định — đây ạ
> (mở `docs/contracts/` và `DECISIONS.md`). Thầy/cô chỉ định bất kỳ module nào, em giải
> thích được luồng và lý do thiết kế của nó."

---

## 5. Kênh & lưu trữ

- Nhóm chat riêng cho đồ án (Zalo/Discord) — không lẫn với chat lớp.
- Google Drive chung: báo cáo (bản Word/LaTeX), biên bản họp GVHD, video demo, ảnh chụp kết quả.
- GitHub private: **code + CSV kết quả thí nghiệm**. Mời GVHD nếu thầy/cô muốn theo dõi.
- Không bao giờ để dữ liệu thí nghiệm chỉ tồn tại ở một nơi (xem
  [`07-giao-thuc-thi-nghiem.md`](07-giao-thuc-thi-nghiem.md) mục "Bảo vệ dữ liệu").

---

## 6. Khi một người bận/ốm

- Review chéo hằng tuần đảm bảo người còn lại nắm đủ để gánh phần cốt lõi.
- Thứ tự ưu tiên khi chỉ còn 1 người làm việc: **thí nghiệm > deploy pipeline > báo cáo >
  migrate > UI polish > Tier 2**.
- Tuần 12 là đệm chính thức cho tình huống này — đừng tiêu nó sớm.
