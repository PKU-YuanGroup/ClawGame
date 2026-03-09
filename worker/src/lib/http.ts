export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function passthrough(res: Response): Promise<Response> {
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function wsBaseFromRequest(request: Request): string {
  const u = new URL(request.url);
  const proto = u.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${u.host}`;
}

export function shortCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
