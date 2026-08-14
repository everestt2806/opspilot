/** Bọc một giá trị người dùng nhập để nối vào chuỗi lệnh SSH (POSIX sh).
 *  Mọi chuỗi từ input đều phải qua đây trước khi ghép lệnh (docs/10 mục 5). */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
