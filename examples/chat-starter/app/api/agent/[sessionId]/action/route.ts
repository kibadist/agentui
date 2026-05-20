import { NextResponse, type NextRequest } from "next/server";
import { publish } from "../stream/route";

type ActionCtx = { params: Promise<{ sessionId: string }> };

export async function POST(req: NextRequest, ctx: ActionCtx) {
  const { sessionId } = await ctx.params;
  const action = (await req.json()) as {
    name?: string;
    payload?: { message?: string };
  };

  // Echo the user's message + a canned agent reply
  const userMsg = action.payload?.message ?? "";
  publish(sessionId, {
    v: 1,
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    sessionId,
    op: "ui.append",
    node: { key: `u-${Date.now()}`, type: "chat.message", props: { from: "user", text: userMsg } },
  });
  setTimeout(() => {
    publish(sessionId, {
      v: 1,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      sessionId,
      op: "ui.append",
      node: {
        key: `a-${Date.now()}`,
        type: "chat.message",
        props: { from: "agent", text: `You said: "${userMsg}"` },
      },
    });
  }, 400);

  return NextResponse.json({ ok: true });
}
