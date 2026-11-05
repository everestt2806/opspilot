import { useMemo, useState } from "react";

const books = [
  {
    id: 1,
    title: "Những con hẻm có tên",
    author: "Lê Tường An",
    category: "Tản văn",
    price: 118000,
    color: "sage",
    motif: "lanes",
    label: "Ghi chép phố",
    description:
      "Một tuyển tập ghi chép về những buổi đi bộ không cần đích đến, những quán quen và câu chuyện nhỏ sau cánh cửa cũ.",
    pages: 184,
  },
  {
    id: 2,
    title: "Ở lại cùng màu sắc",
    author: "Nguyễn Bảo Trâm",
    category: "Thiết kế",
    price: 164000,
    color: "rust",
    motif: "circle",
    label: "Thị giác",
    description:
      "Những quan sát giản dị về màu trong nhà cửa, đường phố và các vật dụng ta gặp hằng ngày.",
    pages: 216,
  },
  {
    id: 3,
    title: "Mùa mưa đến chậm",
    author: "Phan Hoài Nam",
    category: "Văn học",
    price: 139000,
    color: "blue",
    motif: "rain",
    label: "Tiểu thuyết",
    description:
      "Một câu chuyện về hai người bạn trở lại thị trấn cũ, đi qua những điều chưa kịp nói.",
    pages: 264,
  },
  {
    id: 4,
    title: "Một căn bếp nhỏ",
    author: "Trần Khánh Vy",
    category: "Đời sống",
    price: 126000,
    color: "cream",
    motif: "grid",
    label: "Nếp nhà",
    description:
      "Các mẩu chuyện về bữa ăn, việc chăm sóc bản thân và niềm vui của một căn nhà vừa đủ.",
    pages: 172,
  },
  {
    id: 5,
    title: "Đọc thành phố",
    author: "Vũ Lâm",
    category: "Tản văn",
    price: 122000,
    color: "dark",
    motif: "sun",
    label: "Ghi chép phố",
    description:
      "Những trang ngắn dành cho người thích ngồi ở cửa sổ và nhìn một thành phố đổi thay.",
    pages: 196,
  },
  {
    id: 6,
    title: "Bàn tay và vật liệu",
    author: "Mai Phương Linh",
    category: "Thiết kế",
    price: 189000,
    color: "orange",
    motif: "lines",
    label: "Thủ công",
    description:
      "Một cái nhìn gần về giấy, gỗ, vải và cách người làm nghề tìm tiếng nói của mình trong vật liệu.",
    pages: 232,
  },
  {
    id: 7,
    title: "Sau hiên nhà",
    author: "Đỗ Minh Châu",
    category: "Văn học",
    price: 145000,
    color: "olive",
    motif: "window",
    label: "Truyện ngắn",
    description:
      "Sáu truyện ngắn về những cuộc gặp tình cờ và các lựa chọn rất đỗi bình thường.",
    pages: 208,
  },
  {
    id: 8,
    title: "Ngày thường đáng nhớ",
    author: "Hoàng Gia Hân",
    category: "Đời sống",
    price: 112000,
    color: "pink",
    motif: "stairs",
    label: "Nếp nhà",
    description:
      "Gợi ý sắp xếp một ngày có khoảng nghỉ, có việc cần làm và có thời gian dành cho người thân.",
    pages: 160,
  },
];

const categories = ["Tất cả", "Văn học", "Tản văn", "Thiết kế", "Đời sống"];
const formatPrice = (price) =>
  new Intl.NumberFormat("vi-VN").format(price) + " ₫";
const normalize = (value) =>
  value
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");

function readSaved() {
  try {
    const value = JSON.parse(localStorage.getItem("tiem-doc-saved") || "[]");
    return Array.isArray(value)
      ? value.filter((id) => Number.isInteger(id))
      : [];
  } catch {
    return [];
  }
}

function Cover({ book, large = false }) {
  return (
    <div
      className={`cover cover-${book.color} motif-${book.motif}${large ? " cover-large" : ""}`}
      aria-hidden="true"
    >
      <span className="cover-imprint">TIỆM ĐỌC / ẤN BẢN NHỎ</span>
      <span className="cover-motif" />
      <strong>{book.title}</strong>
      <span className="cover-author">{book.author}</span>
    </div>
  );
}

export default function App() {
  const [category, setCategory] = useState("Tất cả");
  const [search, setSearch] = useState("");
  const [saved, setSaved] = useState(readSaved);
  const [savedOnly, setSavedOnly] = useState(false);
  const [openBook, setOpenBook] = useState(null);

  const filtered = useMemo(
    () =>
      books.filter((book) => {
        const matchesCategory =
          category === "Tất cả" || book.category === category;
        const matchesSearch = normalize(
          `${book.title} ${book.author}`,
        ).includes(normalize(search.trim()));
        return (
          matchesCategory &&
          matchesSearch &&
          (!savedOnly || saved.includes(book.id))
        );
      }),
    [category, search, savedOnly, saved],
  );

  function toggleSaved(id) {
    const next = saved.includes(id)
      ? saved.filter((item) => item !== id)
      : [...saved, id];
    setSaved(next);
    try {
      localStorage.setItem("tiem-doc-saved", JSON.stringify(next));
    } catch {
      /* vẫn dùng được trong phiên này */
    }
  }

  return (
    <>
      <header className="site-header">
        <a className="brand" href="#dau-trang">
          <span className="brand-mark">tđ.</span>
          <span>tiệm đọc</span>
        </a>
        <nav aria-label="Điều hướng chính">
          <a href="#ke-sach">Kệ sách</a>
          <a href="#ve-tiem">Về tiệm</a>
        </nav>
        <button
          className="saved-shortcut"
          type="button"
          onClick={() => {
            setSavedOnly(!savedOnly);
            document
              .getElementById("ke-sach")
              ?.scrollIntoView({ behavior: "smooth" });
          }}
          aria-pressed={savedOnly}
        >
          Sách đã lưu <span>{saved.length}</span>
        </button>
      </header>

      <main id="dau-trang">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">MỘT KỆ SÁCH NHỎ, CHỌN KỸ</p>
            <h1>
              Sách cho những
              <br />
              <em>ngày thong thả.</em>
            </h1>
            <p>
              Không cần đọc thật nhanh. Cứ chọn một cuốn hợp với hôm nay, rồi để
              trang sách mở ra phần còn lại.
            </p>
            <a href="#ke-sach" className="text-link">
              Đi một vòng kệ sách <span aria-hidden="true">↗</span>
            </a>
          </div>
          <div className="hero-book">
            <span className="hero-note">CUỐN ĐANG Ở BÀN ĐỌC</span>
            <Cover book={books[0]} large />
            <span className="hero-caption">01 — Một câu chuyện để bắt đầu</span>
          </div>
        </section>

        <section className="collection" id="ke-sach">
          <div className="section-title">
            <div>
              <span className="eyebrow">DANH MỤC MINH HỌA</span>
              <h2>Trên kệ hôm nay</h2>
            </div>
            <p>{filtered.length} cuốn sách</p>
          </div>
          <div className="tools">
            <div className="tabs" role="group" aria-label="Lọc thể loại">
              {categories.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={item === category ? "active" : ""}
                  aria-pressed={item === category}
                  onClick={() => setCategory(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <label className="search">
              <span className="sr-only">Tìm sách hoặc tác giả</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm sách, tác giả…"
                type="search"
              />
            </label>
          </div>
          {savedOnly && (
            <div className="filter-note">
              Đang xem sách đã lưu.{" "}
              <button type="button" onClick={() => setSavedOnly(false)}>
                Xem tất cả
              </button>
            </div>
          )}
          {filtered.length ? (
            <div className="book-grid">
              {filtered.map((book) => (
                <article className="book-card" key={book.id}>
                  <button
                    className="cover-button"
                    type="button"
                    onClick={() => setOpenBook(book)}
                    aria-label={`Xem chi tiết ${book.title}`}
                  >
                    <Cover book={book} />
                  </button>
                  <div className="book-meta">
                    <span>{book.category}</span>
                    <button
                      type="button"
                      className={`save-button ${saved.includes(book.id) ? "is-saved" : ""}`}
                      onClick={() => toggleSaved(book.id)}
                      aria-pressed={saved.includes(book.id)}
                      aria-label={`${saved.includes(book.id) ? "Bỏ lưu" : "Lưu"} ${book.title}`}
                    >
                      {saved.includes(book.id) ? "Đã lưu" : "+ Lưu"}
                    </button>
                  </div>
                  <h3>
                    <button type="button" onClick={() => setOpenBook(book)}>
                      {book.title}
                    </button>
                  </h3>
                  <p>{book.author}</p>
                  <strong className="price">{formatPrice(book.price)}</strong>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty">
              <h3>Chưa tìm thấy cuốn phù hợp.</h3>
              <p>Thử từ khóa khác hoặc quay lại toàn bộ kệ sách.</p>
              <button
                type="button"
                onClick={() => {
                  setCategory("Tất cả");
                  setSearch("");
                  setSavedOnly(false);
                }}
              >
                Xem tất cả sách
              </button>
            </div>
          )}
        </section>

        <section className="about" id="ve-tiem">
          <span className="eyebrow">VỀ TIỆM ĐỌC</span>
          <p>
            Một không gian mẫu cho những ai thích tìm sách theo chủ đề, lưu lại
            cuốn mình quan tâm và đọc chậm hơn một chút.
          </p>
          <span>Chọn một cuốn. Để dành một buổi.</span>
        </section>
      </main>

      <footer>
        <span>© Tiệm Đọc · Danh mục minh họa</span>
        <span>Được làm bằng React &amp; Vite</span>
      </footer>

      {openBook && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpenBook(null);
          }}
        >
          <section
            className="book-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <button
              className="modal-close"
              type="button"
              onClick={() => setOpenBook(null)}
              aria-label="Đóng chi tiết"
            >
              ×
            </button>
            <Cover book={openBook} large />
            <div className="modal-copy">
              <span className="eyebrow">
                {openBook.label} · {openBook.pages} trang
              </span>
              <h2 id="modal-title">{openBook.title}</h2>
              <p className="modal-author">{openBook.author}</p>
              <p className="modal-description">{openBook.description}</p>
              <p className="modal-price">{formatPrice(openBook.price)}</p>
              <button
                className="modal-action"
                type="button"
                onClick={() => toggleSaved(openBook.id)}
              >
                {saved.includes(openBook.id)
                  ? "Bỏ khỏi sách đã lưu"
                  : "Lưu cuốn sách này"}{" "}
                <span aria-hidden="true">↗</span>
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
