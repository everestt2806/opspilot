# Nghiệm thu proof H2 độc lập

Công cụ QA cho checkpoint `feat/product-h2-checkpoint`. Không sửa source, không chạy Docker/SSH/DB và chỉ import Git blob đã handoff đúng SHA. Fixtures, key và host `.invalid` đều là dữ liệu tổng hợp công khai. Không dùng key fixture để enroll lab hoặc production.

Từ root worktree QA, chạy self-tests bằng Node 22:

```powershell
node --test app/scripts/h2-independent/tool.check.mjs
```

Self-tests kiểm công cụ bằng mock fixture, Git repo tạm riêng, timeout/output bounds và redaction. PASS của self-tests không phải PASS của implementation H2.

Kiểm tra trạng thái bàn giao, không compile/thực thi Worker:

```powershell
node app/scripts/h2-independent/run.mjs --inspect --worker . --sha <full-40-hex-sha>
```

Sau khi Worker hoàn tất và bàn giao sạch, bỏ `--inspect` để chạy component proof. Cần dependencies đã cài đúng frozen lockfile của worktree QA (Zod, esbuild qua Vite); công cụ không tự install hoặc thay manifest/lockfile. Chỉ compile blob `productH2Proof.ts` từ commit Git được chỉ định, dùng dependencies QA, không import worktree đang sửa. Contract digest trong report là fingerprint source, không chứng minh TypeScript/Python đã tương thích.

Gate yêu cầu cùng Git repository, đúng branch Worker, SHA đầy đủ trùng HEAD, status sạch, HANDOFF-LOCAL mới ở commit đó và READY_FOR_LEADER_RETEST; PARTIAL/BLOCKED/NOT_RUN trong block handoff bị chặn bảo thủ. Nếu Worker tiếp tục START/UPDATE, phải handoff lại. HEAD/status được kiểm tra lại sau child; thay đổi thì INCONCLUSIVE. Gate không ngăn được việc Worker sửa rồi trả lại trạng thái cũ giữa hai lần đọc; toàn bộ source chạy vẫn cố định theo Git SHA.

Child timeout 15 giây, stdout/stderr tối đa 256 KiB mỗi stream. Chỉ trả metadata case ID/count/verdict; exception/output tùy ý không được echo. Child riêng giới hạn tài nguyên cơ bản, **không phải security sandbox cho mã không tin cậy**. Compiled blob/report và fixture Git self-tests nằm trong `app/.out-scripts/` của QA (ignored); không ghi Worker. Tool không tự clean tài nguyên khác.

Exit 0: READY với `--inspect`, hoặc component proof PASS với lệnh chạy. Exit 1: có case component FAIL. Exit 2: chưa đủ handoff, invalid input, harness error hoặc snapshot thay đổi. Luôn đọc `scope/status/gate`; exit 0 của inspect không phải test PASS.

Phạm vi: receipt schema, whole runtime identity consistency, canonical JSON, SHA256 và HMAC domain separation. Không chứng minh DB authority/CAS, metric barriers/B0/R0, quiescence, seal durability, crash recovery, artifact/CLI hay live SSH/Docker. Trạng thái và giới hạn kiểm chứng nằm trong `docs/tasks/tk-s7-product-h2-runtime.md`. Checkpoint hiện PARTIAL nên inspect được phép trả WAITING; không đổi gate để nhận full READY.
