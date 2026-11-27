# Live Desktop — nhận lại controller và triển khai Git

Checkpoint product-mode R3c-6h4c-3b2 dành riêng cho development VPS167.71.202.116, known original installation/controller/current upgrade. Không dùng production Desktop profile, không thay protected catalog hoặc nâng cấp controller lần nữa.

Yêu cầu Windows/Node22, Python virtualenv đã duyệt, current built Main resource verifier/preload và đủ approved original/current resources. VPS phải giữ app1/san-nha-live/deployment4/port30000, controller029/current UUID37a115d5, paused policy và không active job/experiment. Script kiểm pinned SSH trước xác thực và snapshot SQLite chỉ đọc trước khi thao tác. Chỉ sử dụng khi user đã cho phép development VPS và checkpoint push.

```powershell
. ./tools/enter-node22.ps1
ml-service/.venv/Scripts/python.exe app/scripts/controller-upgrade-live/hidden-input.py --desktop-preflight
# Sau readonly preflight, dùng nonce16hex public do script trả về:
ml-service/.venv/Scripts/python.exe app/scripts/controller-upgrade-live/hidden-input.py --desktop-resume <nonce>
```

Credential chỉ nhập ở hidden prompt rồi qua anonymous stdin vào Node. Node tạo AES-GCM private Desktop031 profile dưới `app/.out-scripts/controller-desktop-live/<nonce>/private-profile`, key32bytes được Windows user-scoped DPAPI bảo vệ bằng helper hiện có. Electron chỉ nhận nonce/mode public, tự mở existing sealed key bằng bounded anonymous child pipe; không secret argv/env/plaintext file/log. Đây là operational proof key format, không thay production safeStorage key. Cả Node và Electron kiểm lại host/port/user/fingerprint của private VPS trước SSH.

Hai tiến trình Electron riêng: `--onboard` chạy production installer wizard/preload/typed channels/actual Main/pinned SSH, cold discovery/adoption, separate permission/enrollment và đọc existing canonical app1 qua authenticated API. Sau khi đóng hẳn, `--deploy` mở lại encrypted DB/DPAPI và kiểm same token hash/client/UUID, fresh current inspect qua UI rồi dùng production Project panel để đăng ký Git/source check/target enrollment/firstdeploy. SSH và API đều thật, không synthetic transport hoặc SQL metadata import.

App thử có tên `desktop-live-<nonce8>`, repo công khai `everestt2806/opspilot`, nhánh `demo/r3c6h3-20261110`, root `demo-apps/san-nha-booking`, full SHA phải làbfed8941e2a719b04fa960142b7c3df0eed66b57. Dùng target đã đăng ký, port30001 và paused policy riêng. Không redeploy app1, không bật auto policy hoặc đổi target credentials. Source/target/readiness/firstdeploy đều cần UI review và Main fences; thiếu tài nguyên hoặc port bận phải dừng, không chiếm workload khác.

Giữ nguyên Root receipt/current journal/controller ID/service PID/runtime key/DB inode/canonical target digest và app1. Sau thành công, app demo mới healthy/paused được giữ lại với ownership và URL rõ ràng; independent Windows public HTTP + Main exposure API phải pass. Thu hồi đúng temporary API client; Node chỉ xóa đúng private profile sau settled PASS và revoke thành công. Các capture/proof chỉ public metadata, token chỉ ghi hash để đối chiếu trong private record.

Khi lỗi, giữ encrypted profile/sealed key và cùng setup/command UUID để tiếp tục `--desktop-resume <nonce>`; không tạo app/nonce mới hoặc replay deployment để né unknown. Onboarding đã PASS thì không enroll lại. Dự án đã có thì dùng setup cũ; lệnh firstdeploy tồn tại thì chỉ cập nhật trạng thái. Không xóa shared Docker/target namespace hoặc canonical DB bằng SQL. `failure.png` dùng chẩn đoán GUI trong thư mục ignored; chỉ final PASS được dùng làm bằng chứng checkpoint.

Nếu client đã được thu hồi trước khi kiểm tra cuối lỗi, resume chỉ chạy readonly finalization bằng SSH, không mở lại UI/enroll token hoặc gửi job. Finalizer giữ bản failure cũ, đối chiếu exact owned app/deployment/commit/paused policy/observation ID và revoked client trong SQLite chỉ đọc, kiểm0active clients/jobs/experiments, same Root journal/PID/key/DB inode và HTTP200 cả30000/30001. Chỉ sau đó mới chốt PASS và dọn private profile. Ghi rõ đây là operational finalization sau GUI, không relabel một lần UI fail thành UI rerun thành công. Lỗi harness từng gặp: Ant Select cần mousedown như tương tác người dùng; baseline sau resume đã bao gồm chính temporary client, nên sau revoke phải đếm0 thay vì so với count trước revoke.

Exposure reachable là observation có timestamp/TTL60s. Việc giữ evidence trong SQLite sau khi client bị revoke không gia hạn độ mới hoặc giữ UI xanh vĩnh viễn; final HTTP200 chỉ là phép đo độc lập bổ sung. Firstdeploy không thay các gate tự deploy mới, migration workload, template khác, OS reboot/soak hoặc signed release distribution.
