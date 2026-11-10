const express = require("express");
const path = require("path");

const app = express();
const port = Number(process.env.PORT || 3000);
const courts = [
  { id: "san-a", name: "Sân A", note: "Cỏ mới, gần khu để xe" },
  { id: "san-b", name: "Sân B", note: "Thoáng, nhiều bóng râm" },
];
const times = ["17:00", "18:30", "20:00", "21:30"];
const reservations = new Map();

function todayInVietnam() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function nextDays() {
  const today = todayInVietnam();
  const start = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, index) =>
    new Date(start + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );
}

function makeSlots(date) {
  return courts.flatMap((court) =>
    times.map((time) => {
      const id = `${court.id}-${time.replace(":", "")}`;
      return {
        id,
        court: court.name,
        note: court.note,
        time,
        duration: 90,
        price: time >= "20:00" ? 300000 : 260000,
        available: !reservations.has(`${date}/${id}`),
      };
    }),
  );
}

app.disable("x-powered-by");
app.use(express.json({ limit: "4kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_request, response) => {
  response
    .set("Cache-Control", "no-store")
    .json({ status: "ok", service: "san-nha-booking" });
});

app.get("/api/slots", (request, response) => {
  const days = nextDays();
  const date =
    typeof request.query.date === "string" ? request.query.date : days[0];
  if (!days.includes(date)) {
    return response
      .status(400)
      .json({ error: "Chỉ xem lịch trong 7 ngày tới." });
  }
  response
    .set("Cache-Control", "no-store")
    .json({ date, days, slots: makeSlots(date) });
});

app.post("/api/reservations", (request, response) => {
  const { date, slotId, name } = request.body || {};
  const cleanName = typeof name === "string" ? name.trim() : "";
  if (
    !nextDays().includes(date) ||
    typeof slotId !== "string" ||
    cleanName.length < 2 ||
    cleanName.length > 40
  ) {
    return response
      .status(400)
      .json({ error: "Vui lòng chọn giờ và nhập tên từ 2 đến 40 ký tự." });
  }
  const slot = makeSlots(date).find((item) => item.id === slotId);
  if (!slot)
    return response.status(400).json({ error: "Khung giờ không hợp lệ." });
  if (!slot.available)
    return response
      .status(409)
      .json({ error: "Khung giờ này vừa được giữ. Vui lòng chọn giờ khác." });

  const code = `SN-${String(reservations.size + 1).padStart(3, "0")}`;
  reservations.set(`${date}/${slotId}`, { code, name: cleanName });
  response.status(201).json({ code, date, court: slot.court, time: slot.time });
});

app.use("/api", (_request, response) =>
  response.status(404).json({ error: "Không tìm thấy API." }),
);

app.listen(port, "0.0.0.0", () => {
  console.log(`Sân Nhà đang chạy trên cổng ${port}`);
});
