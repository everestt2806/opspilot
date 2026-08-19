## Việc gì

<!-- 1-3 câu. Module nào, giải quyết yêu cầu nào (FR-xx / UC-xx). -->

Liên quan: `M__` · FR-__ / UC-__

## Cách kiểm chứng

<!-- Người review chạy gì để tin là nó chạy? Lệnh cụ thể, không phải "đã test rồi". -->

```
pnpm try:___
```

## Quyết định thiết kế đáng chú ý

<!-- Chỗ nào có đánh đổi? Vì sao chọn cách này? Nếu không có thì ghi "không có". -->

## Checklist tác giả

- [ ] `pnpm test` / `pytest` xanh, `lint` không lỗi
- [ ] **Bám đúng contract** trong `docs/contracts/` — không đổi tên hàm/trường/event
- [ ] Không thêm dependency ngoài danh sách đã duyệt (`docs/09` mục 2)
- [ ] Không có secret trong diff
- [ ] Module chạy được **độc lập bằng CLI** trước khi nối vào UI
- [ ] Đã cập nhật `docs/05-truy-vet-yeu-cau.md` nếu hoàn thành một FR
- [ ] Đã ghi `DECISIONS.md` nếu lệch kế hoạch
- [ ] **Đã cập nhật `docs/tasks/board.md` + hồ sơ tk** (nhật ký, lệnh tái hiện, link PR) cùng commit này — bắt buộc, xem `docs/tasks/README.md` mục 3
- [ ] Đã chạy prompt tự review (`docs/prompts/99-review.md`)
- [ ] **Tôi giải thích được từng hàm public trong diff này trước hội đồng**

## Checklist người review (trong 24 giờ)

- [ ] Tôi hiểu **mục đích** của mọi hàm public trong diff
- [ ] Tôi biết module này hỏng thì **ảnh hưởng gì** tới phần của tôi
- [ ] `docs/tasks/board.md` + hồ sơ tk phản ánh **đúng trạng thái** sau merge
- [ ] Chỗ nào không hiểu → **đã hỏi**, không approve cho xong
