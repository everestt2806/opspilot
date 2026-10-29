const daysEl = document.querySelector("#days");
const slotsEl = document.querySelector("#slots");
const selectionEl = document.querySelector("#selection");
const form = document.querySelector("#reservation-form");
const messageEl = document.querySelector("#message");
const state = { date: null, days: [], slots: [], selected: null };

const money = (value) => new Intl.NumberFormat("vi-VN").format(value) + " đ";
const dayLabel = (key) => {
  const date = new Date(`${key}T00:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat("vi-VN", {
      weekday: "short",
      timeZone: "UTC",
    }).format(date),
    day: new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "UTC",
    }).format(date),
  };
};

function message(text, kind = "") {
  messageEl.textContent = text;
  messageEl.className = `message ${kind}`;
}

function renderDays() {
  daysEl.replaceChildren();
  for (const key of state.days) {
    const label = dayLabel(key);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "day";
    button.setAttribute("aria-pressed", String(key === state.date));
    button.innerHTML = `<small>${label.weekday}</small><strong>${label.day}</strong>`;
    button.addEventListener("click", () => loadSlots(key));
    daysEl.append(button);
  }
}

function renderSelection() {
  const slot = state.selected;
  form.hidden = !slot;
  if (!slot) {
    selectionEl.className = "selection-empty";
    selectionEl.textContent = "Chọn một giờ còn trống để xem chi tiết tại đây.";
    return;
  }
  selectionEl.className = "selection-details";
  const date = dayLabel(state.date);
  selectionEl.innerHTML = `<strong>${slot.court} · ${slot.time}</strong><p>${date.weekday}, ${date.day} · 90 phút</p><p class="price"><span>Giá một lượt</span><span>${money(slot.price)}</span></p>`;
}

function renderSlots() {
  slotsEl.replaceChildren();
  for (const court of ["Sân A", "Sân B"]) {
    const sample = state.slots.find((slot) => slot.court === court);
    const card = document.createElement("article");
    card.className = "court-card";
    const info = document.createElement("div");
    info.innerHTML = `<h3>${court}</h3><p>${sample.note}</p>`;
    const grid = document.createElement("div");
    grid.className = "slot-grid";
    for (const slot of state.slots.filter((item) => item.court === court)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "slot";
      button.disabled = !slot.available;
      button.setAttribute(
        "aria-pressed",
        String(state.selected?.id === slot.id),
      );
      button.innerHTML = `<span>${slot.time}</span><small>${slot.available ? money(slot.price) : "Đã có lịch"}</small>`;
      button.addEventListener("click", () => {
        state.selected = slot;
        message("");
        renderSelection();
        renderSlots();
      });
      grid.append(button);
    }
    card.append(info, grid);
    slotsEl.append(card);
  }
}

async function loadSlots(date) {
  slotsEl.innerHTML = '<p class="loading">Đang tải lịch sân…</p>';
  try {
    const response = await fetch(
      `/api/slots${date ? `?date=${encodeURIComponent(date)}` : ""}`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error("Không tải được lịch sân.");
    const data = await response.json();
    state.date = data.date;
    state.days = data.days;
    state.slots = data.slots;
    state.selected = null;
    renderDays();
    renderSlots();
    renderSelection();
  } catch {
    slotsEl.innerHTML =
      '<p class="load-error">Không tải được lịch sân. Vui lòng tải lại trang.</p>';
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.selected) return;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  message("Đang giữ lịch…");
  try {
    const response = await fetch("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: state.date,
        slotId: state.selected.id,
        name: form.elements.namedItem("name").value,
      }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Không giữ được lịch sân.");
    form.reset();
    await loadSlots(state.date);
    message(
      `Đã giữ ${result.court} lúc ${result.time}. Mã lịch: ${result.code}.`,
      "success",
    );
  } catch (error) {
    message(error.message, "error");
    await loadSlots(state.date);
  } finally {
    button.disabled = false;
  }
});

loadSlots();
