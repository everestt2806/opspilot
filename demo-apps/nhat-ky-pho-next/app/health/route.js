export function GET() {
  return Response.json(
    { status: "ok", service: "nhat-ky-pho-next" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
