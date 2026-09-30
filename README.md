# Focus Guard

Extension Chrome nhẹ: goals mỗi ngày → thời gian focus → một nhịp dừng trước các site gây xao nhãng. HTML/CSS/JavaScript thuần, Manifest V3, không framework, không build, không dependency sản phẩm. UI tiếng Anh; dữ liệu chỉ lưu trên thiết bị.

## Kết quả theo từng bước

1. **Goals + popup:** đã có onboarding, tick/untick, Edit và Unicode. Thử bằng nhập goal tiếng Việt rồi tick/sửa.
2. **Focus:** đã có Start/Stop, timer, tổng giờ và timer session. Thử đóng popup khi đang chạy, sau đó mở lại và Stop/Start.
3. **Blocker:** đã có reason, countdown 30 giây bền qua reload, manual Open và Back. Thử reason rỗng và refresh trong lúc chờ.
4. **Distraction:** đã theo dõi active foreground/idle, tạm dừng focus và kết thúc lượt khi rời tab/app. Thử đổi tab và xem log.
5. **Summary/history:** đã có goals/totals/stopped, tuần thứ Hai–Chủ nhật và log lý do/thời lượng theo giờ. So sánh số liệu với popup.
6. **Settings:** đã có thêm/xóa domain và hai lựa chọn sau khi hoàn thành goals. Thử thêm URL, subdomain, tick toàn bộ rồi untick.
7. **Polish:** đã có font/icon gốc cục bộ, pressed states, keyboard focus, README và DECISIONS. Kiểm tra giao diện và cài Load unpacked.

Các bước đã tích hợp; không còn phần tính năng trong kế hoạch chưa triển khai. Kiểm thử tự động gồm các bài logic/worker và smoke test Chromium trên site fixture cục bộ. Việc còn cần kiểm tra thủ công trước phát hành rộng là CSS/navigation của sáu site thật và idle/lock/sleep trên từng hệ điều hành.

## Cài trên Chrome

1. Dùng Chrome desktop phiên bản 120 trở lên.
2. Mở `chrome://extensions`, bật **Developer mode**.
3. Chọn **Load unpacked**, chọn thư mục chứa `manifest.json` này.
4. Ghim **Focus Guard** lên thanh công cụ và bấm icon.
5. Nhập 1–3 goals rồi chọn **Start My Day**. Bấm **Start Focus** khi bắt đầu làm việc.

Không cần `npm install`. Khi cập nhật mã, bấm **Reload** trên thẻ extension và reload các tab distraction đang mở. Chrome không cho content script chạy trên trang nội bộ như `chrome://…` hoặc Chrome Web Store.

## Cách dùng

- Tick/untick goals; **Edit** để sửa. Ngày mới theo đồng hồ địa phương bắt đầu với goals trống.
- Focus và distraction hiển thị cố định bằng giờ thập phân (h). **Stop** kết thúc session; toàn bộ thời gian vẫn được giữ trong tổng ngày.
- YouTube, Facebook, Reddit, TikTok, Instagram và X mặc định có blocker. Subdomain cũng được tính.
- Nhập lý do → chờ 30 giây → tự bấm **Open**. Reload không reset countdown. **Back to focus** đưa về trang an toàn gần nhất đã ghi nhận hoặc New Tab.
- Chỉ sau Open mới tính distraction, khi tab active, Chrome foreground và máy chưa idle. Bộ đếm nhỏ trong Shadow DOM luôn hiển thị ở góc dưới phải trên các site distraction, kể cả khi goals đã hoàn thành.
- Sau mỗi 5 phút active trong một lượt, hiện lời nhắc trên trang trong 20 giây (**Back to focus** đóng tab distraction hiện tại; **Dismiss** đóng ngay). Reload giữ thời gian và không lặp lại mốc đã nhắc; idle không cộng vào mốc nhắc. Thời gian được tô đỏ; bộ đếm chuyển động lên xuống nhẹ. Animation tôn trọng reduced motion.
- Sau Open, chuyển tab hoặc chuyển sang ứng dụng khác kết thúc lượt. Quay lại phải nhập lý do và chờ lại. Idle chỉ tạm dừng lượt.
- **Summary** có goals, tổng giờ, số lần quay về focus và tuần hiện tại. **History** có distraction log hôm nay.
- **Settings** thêm/xóa domain và chọn hành vi sau khi hoàn thành toàn bộ goals. Mặc định bỏ blocker nhưng vẫn tính distraction.

## Thử bằng tay

1. Nhập goal tiếng Việt, tick/untick, sửa; kiểm tra Summary khớp.
2. Start Focus, đóng popup, mở lại sau một phút. Timer và tổng ngày phải tiếp tục. Stop/Start không xóa thời gian đã tích lũy.
3. Mở YouTube: trang bên dưới không thao tác được. Continue với lý do rỗng phải hiện lỗi. Nhập lý do và reload trong countdown; thời gian còn lại phải tiếp tục.
4. Chờ READY: trang vẫn bị che đến khi tự bấm Open. Thử Back ở bước reason, countdown và ready; Summary tăng đúng một lần.
5. Sau Open, chuyển tab rồi quay lại: blocker xuất hiện lại. Chuyển sang Reddit cần lý do mới. Refresh trong cùng site giữ lượt hiện tại.
6. Theo dõi log và tổng distraction khi đổi tab, minimize và đổi ứng dụng: chỉ tab foreground mới cộng. Focus vẫn cộng khi làm trong ứng dụng khác.
7. Để máy idle hơn 60 giây hoặc khóa/ngủ, sau đó quay lại; không được cộng khoảng gián đoạn dài. Xem giới hạn độ chính xác bên dưới.
8. Hoàn thành tất cả goals: mặc định bỏ blocker. Untick hoặc chọn Keep Focus Guard on: blocker trở lại.
9. Thêm domain (có thể dán URL), thử subdomain rồi xóa. Domain vừa xóa được dùng bình thường.
10. Qua ngày mới: goals trống; focus đang chạy tiếp tục vào ngày mới. Khởi động lại Chrome: timer cũ dừng, không tính thời gian trình duyệt đóng.

## Kiểm tra tự động

Node.js **24+** chỉ dùng cho phát triển/kiểm thử, không cần để chạy extension:

```sh
npm test
npm run check
npm run test:browser
```

`npm test` kiểm tra logic và service worker với Chrome API giả lập, gồm session, foreground, idle, countdown, midnight và settings. `npm run check` kiểm tra manifest, file đóng gói, cú pháp và assets.

Smoke test dùng Chromium thật, profile riêng trong thư mục tạm, một site fixture HTTP cục bộ và countdown thật 30 giây; không dùng profile hoặc dữ liệu người dùng. Mặc định binary `/usr/lib64/chromium-browser/chromium-browser`; có thể đặt `CHROMIUM_PATH` trỏ đến Chromium của bạn. Test in đường dẫn ảnh chụp để kiểm tra giao diện. Không tự tải browser hay dependency.

## Quyền và dữ liệu

- `storage`: goals, settings, totals và log ở `chrome.storage.local`; workflow tab/countdown ở `chrome.storage.session`.
- `tabs`: biết tab/site active, kết thúc lượt khi điều hướng và thực hiện Back to focus.
- `idle`: tạm dừng khi máy idle hoặc locked.
- `alarms`: checkpoint thời gian 30 giây, hoạt động khi popup đóng.
- `scripting` và quyền HTTP/HTTPS: đăng ký blocker cho domain người dùng chọn. Content script chỉ đăng ký trên danh sách distraction; không phân tích nội dung web hoặc gửi dữ liệu ra ngoài.

Goals/lý do được hiển thị dưới dạng text, không thực thi HTML. Không có sync, tài khoản, tracking analytics hoặc yêu cầu mạng từ extension. Trang web được mở vẫn có các kết nối của chính trang đó.

## Giới hạn độ chính xác

Chrome báo idle theo ngưỡng **60 giây**; thời gian trong ngưỡng đó có thể vẫn được tính. Worker checkpoint mỗi 30 giây; nếu khoảng gián đoạn vượt **45 giây**, toàn bộ khoảng đó không được cộng, tránh tính nhầm thời gian ngủ. Điều này có thể bỏ sót một ít thời gian active khi Chrome xử lý trễ. Đây là công cụ tự theo dõi, không phải đồng hồ đo sự chú ý tuyệt đối.

Blocker tạo friction trên trang, không chặn tải mạng/audio hoặc chống người dùng cố tình gỡ extension. Xem [DECISIONS.md](DECISIONS.md) cho các lựa chọn chi tiết.

## Artwork

Font pixel 5×7 và icon là artwork gốc, đóng gói cục bộ theo CC0. Có thể tạo lại bằng `python3 scripts/build-assets.py` (chỉ standard library). Goals và lý do dùng font monospace hỗ trợ Unicode. Không dùng tài sản Nintendo, audio hay tài nguyên CDN.
