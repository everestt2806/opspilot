# Prompt tự review trước khi mở PR

Dán khối dưới đây vào AI **kèm diff** (`git diff main...HEAD`) trước khi mở PR.
Đây là lớp lọc đầu; lớp thứ hai là người kia đọc trong 24 giờ.

---

```
Hãy review đoạn code sau như một người sắp phải BẢO VỆ nó trước hội đồng chấm đồ án.

Bối cảnh: đây là đồ án tốt nghiệp, ứng dụng Electron deploy app lên VPS qua SSH kèm module
ML phát hiện suy giảm vận hành. Tôi đã cung cấp CLAUDE.md và các contract trong docs/contracts/.

Kiểm tra theo đúng thứ tự sau, mỗi mục trả lời NGẮN GỌN, chỉ nêu vấn đề thật:

1. VI PHẠM HỢP ĐỒNG — nghiêm trọng nhất
   - Có chỗ nào đổi tên hàm/tham số/kiểu/tên trường so với docs/contracts/ không?
   - Có tên bảng, tên cột, tên event, tên endpoint nào khác với contract không?
   - Có thêm dependency ngoài danh sách đã duyệt ở docs/09-moi-truong-dev.md không?

2. VI PHẠM QUY TẮC BẤT BIẾN (CLAUDE.md mục 2)
   - Có thêm tiến trình/dịch vụ/tầng trừu tượng nào không cần thiết không?
   - Có làm gì nằm trong danh sách "KHÔNG LÀM" (docs/01-ke-hoach.md PHẦN 8) không?

3. AN TOÀN DỮ LIỆU
   - Có nguy cơ ghi secret (.env, private key, password) ra log hoặc DB không?
   - Có nhánh nào có thể xoá volume/thư mục data trên VPS không?
   - Có câu SQL nối chuỗi thay vì prepared statement không?
   - Có giá trị người dùng nhập đi thẳng vào lệnh shell mà không qua shellQuote() không?

4. ĐÚNG ĐẮN
   - Xử lý lỗi: có catch rỗng, có promise không ai bắt, có lỗi bị nuốt không?
   - Trường hợp biên: null vs 0, mảng rỗng, mất kết nối giữa chừng, chạy chồng lần poll?
   - Có chỗ nào dùng 0 thay cho null khi "không đo được" không?
   - Thời gian: có chỗ nào trộn đồng hồ VPS với đồng hồ máy user không?

5. ĐƠN GIẢN HOÁ
   - Đoạn nào phức tạp hơn mức cần thiết cho một đồ án 2 người?
   - Có trừu tượng hoá nào chỉ dùng đúng một lần không?

6. CÂU HỎI HỘI ĐỒNG CÓ THỂ HỎI
   Nêu 3 câu hỏi khó nhất mà giảng viên có thể hỏi về đoạn code này, và gợi ý hướng trả lời.

7. TRẠNG THÁI TASK
   - Commit này có cập nhật docs/tasks/board.md và hồ sơ tk-*.md đúng trạng thái mới không?
     (bắt buộc, xem docs/tasks/README.md mục 3)

KHÔNG cần khen. KHÔNG đề xuất refactor lớn. KHÔNG đề xuất thêm thư viện.
Nếu không có vấn đề ở mục nào, ghi "OK" cho mục đó.
```

---

## Checklist thủ công đi kèm (`docs/10-quy-uoc-code.md` mục 9)

- [ ] `pnpm test` / `pytest` xanh
- [ ] `pnpm lint` / `ruff check` không lỗi
- [ ] Không còn `console.log` debug, không còn `TODO` không có người nhận
- [ ] `git diff --staged | grep -iE 'password|secret|BEGIN.*KEY'` → không có giá trị thật
- [ ] Đã cập nhật `docs/05-truy-vet-yeu-cau.md` nếu hoàn thành một FR
- [ ] Đã ghi `DECISIONS.md` nếu lệch kế hoạch
- [ ] Đã cập nhật `docs/tasks/board.md` + hồ sơ `docs/tasks/tk-*.md` cùng commit (bắt buộc)
- [ ] **Tự giải thích được từng hàm public trong diff**

## Checklist cho người review (24 giờ)

Mục tiêu là **nắm code của nhau**, không phải soi lỗi. Sau khi review phải trả lời được:
*"Đoạn này làm gì, vì sao làm thế, nếu hỏng thì hỏng ở đâu?"*

- [ ] Tôi hiểu **mục đích** của mọi hàm public trong diff
- [ ] Tôi biết module này **hỏng thì ảnh hưởng gì** tới phần của tôi
- [ ] Có chỗ nào tôi không hiểu → **đã hỏi**, không approve cho xong
