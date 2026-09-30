# Các quyết định cho bản đầu

- **Chrome desktop 120+, Manifest V3**, HTML/CSS/JavaScript thuần; không build và không dependency runtime. Node 24 dùng cho test, Python standard library dùng để tạo artwork.
- **Ngày địa phương**, tuần thứ Hai–Chủ nhật. Khoảng thời gian qua nửa đêm được chia vào từng ngày. Giữ history trên thiết bị; không tự xóa dữ liệu.
- **Goals:** 1–3 dòng không rỗng khi lưu, tối đa 200 ký tự/dòng; trim đầu/cuối. Đổi nội dung goal đưa goal đó về chưa hoàn thành; nội dung giữ nguyên giữ tick. Chỉnh theo vị trí dòng; không có kéo/sắp xếp.
- **Blocks:** lưu mili giây, lấy phần nguyên mỗi 600.000 ms. Phút trên UI lấy phần nguyên; timer session đến giây. Tiến độ block dựa trên tổng focus trong ngày, không theo session.
- **Focus trong ứng dụng khác vẫn tính**, miễn OS active. Foreground distraction, gồm blocker, tạm dừng focus. Không foreground thì distraction không cộng và focus có thể tiếp tục.
- **Idle 60 giây**, heartbeat 30 giây; bỏ khoảng gián đoạn trên 45 giây và khoảng đồng hồ đi lùi. Khi worker được Chrome khởi động lại, phục hồi checkpoint ngắn từ session storage. Chrome đóng/mở lại thì dừng focus cũ, không tính offline.
- **Lượt truy cập:** sau Open, rời tab hoặc mất foreground Chrome kết thúc lượt, trở lại yêu cầu reason/countdown mới. Idle/lock tạm dừng lượt; không tự hỏi lại nếu tab vẫn giữ foreground. Countdown chưa mở vẫn tiếp tục khi chuyển tab.
- **Refresh và điều hướng cùng nhóm site** giữ workflow khi tab chưa rời foreground. X gồm `x.com` và `twitter.com`. Sang nhóm site khác bắt đầu workflow mới.
- **Countdown:** mốc kết thúc tuyệt đối 30 giây, lưu `storage.session`; sống qua reload và worker restart, không qua browser restart. Máy ngủ trong countdown vẫn làm mốc chờ hết; luôn cần manual Open.
- **Distraction chỉ tính sau Open/bypass**, không tính thời gian nhập reason/chờ. Log hiển thị thời gian active được cộng, không phải toàn bộ thời gian từ mở đến đóng. Lượt qua nửa đêm được chia thành dòng theo ngày.
- **Reason:** nhận bất kỳ chuỗi không rỗng sau trim, không phân tích/đánh giá hoặc giới hạn nhân tạo. Chỉ reason của lượt đã mở đi vào log; reason đang chờ ở session storage.
- **Sau tất cả goals hoàn thành:** mặc định allow, vẫn log/count distraction với lý do trống và UI “Goals completed”. Zero goals không được xem là hoàn thành. Untick, sửa goals, setting hoặc ngày mới đánh giá lại quyền bypass.
- **Back to focus:** dùng URL an toàn gần nhất của chính tab đã ghi nhận; nếu không có thì New Tab. Chỉ Back tại blocker tăng stopped, một lần mỗi workflow; rời tab bình thường không tăng.
- **Settings:** chuẩn hóa domain/URL, nhận HTTP/HTTPS và subdomain; không nhận wildcard, credential hay port trong cấu hình. Quyền host rộng để thêm domain không cần popup cấp quyền mỗi lần; chỉ đăng ký script trên danh sách đã chọn. Clear data tùy chọn được bỏ khỏi v1.
- **Overlay:** CSS `document_start` che trang, UI trong Shadow DOM. Không chặn network/audio và không cố chống thao tác DevTools/gỡ extension. Kiểm thử site thật vẫn cần khi phát hành.
- **Font/art:** font gốc 5×7 và icon gốc, CC0, tải cục bộ. Chữ nhập của người dùng dùng monospace Unicode để đọc tiếng Việt đúng. Không audio.
- **Màn hình:** popup chính; một trang extension với ba view Summary/History/Settings. Không thêm score, targets, breaks, streaks hoặc tính năng ngoài sản phẩm.
