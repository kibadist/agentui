import { NextResponse, type NextRequest } from "next/server";
import { publish } from "../stream/route";

type ActionCtx = { params: Promise<{ sessionId: string }> };

function event(sessionId: string, body: object) {
  return {
    v: 1,
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    sessionId,
    ...body,
  };
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runAnswerScript(sessionId: string, question: string) {
  // 1) Echo the user's question
  publish(sessionId, event(sessionId, {
    op: "ui.append",
    node: { key: `q-${Date.now()}`, type: "support.message", props: { from: "user", text: question } },
  }));

  await sleep(200);

  // 2) Tool call: search KB
  const toolId = crypto.randomUUID();
  publish(sessionId, event(sessionId, {
    op: "tool.start",
    id: toolId,
    name: "search_kb",
    args: { query: question },
  }));

  await sleep(600);

  publish(sessionId, event(sessionId, {
    op: "tool.result",
    id: toolId,
    status: "ok",
    result: { hits: 2 },
    durationMs: 600,
  }));

  // 3) Reasoning trace
  const rId = crypto.randomUUID();
  publish(sessionId, event(sessionId, { op: "reasoning.start", id: rId }));
  for (const chunk of ["Looking through KB... ", "found two relevant articles. ", "Composing answer."]) {
    publish(sessionId, event(sessionId, { op: "reasoning.delta", id: rId, delta: chunk }));
    await sleep(150);
  }
  publish(sessionId, event(sessionId, { op: "reasoning.end", id: rId }));

  // 4) Render KB snippets + answer
  publish(sessionId, event(sessionId, {
    op: "ui.append",
    node: {
      key: `kb-${Date.now()}-1`,
      type: "support.kb-snippet",
      props: { title: "Resetting your password", body: "Click 'Forgot password' on the sign-in page. Check your inbox for a reset link." },
    },
  }));
  publish(sessionId, event(sessionId, {
    op: "ui.append",
    node: {
      key: `kb-${Date.now()}-2`,
      type: "support.kb-snippet",
      props: { title: "If the email doesn't arrive", body: "Check spam, or contact support@example.com with your account email." },
    },
  }));

  await sleep(200);

  publish(sessionId, event(sessionId, {
    op: "ui.append",
    node: {
      key: `a-${Date.now()}`,
      type: "support.message",
      props: {
        from: "agent",
        text: "Click 'Forgot password' on the sign-in page. If the email doesn't arrive within a few minutes, check your spam folder or reach out to support.",
      },
    },
  }));
}

async function runUploadScript(sessionId: string, filename: string, size: number) {
  publish(sessionId, event(sessionId, {
    op: "ui.toast",
    level: "info",
    message: `received ${filename} (${size} bytes)`,
  }));
  await sleep(300);
  publish(sessionId, event(sessionId, {
    op: "ui.append",
    node: {
      key: `up-${Date.now()}`,
      type: "support.message",
      props: { from: "agent", text: `Got ${filename}. (This is a stub — no real upload happens in this example.)` },
    },
  }));
}

export async function POST(req: NextRequest, ctx: ActionCtx) {
  const { sessionId } = await ctx.params;
  const action = (await req.json()) as {
    name?: string;
    payload?: { question?: string; filename?: string; size?: number };
  };

  if (action.name === "support.ask" && action.payload?.question) {
    void runAnswerScript(sessionId, action.payload.question);
  } else if (action.name === "support.upload" && action.payload?.filename) {
    void runUploadScript(sessionId, action.payload.filename, action.payload.size ?? 0);
  }

  return NextResponse.json({ ok: true });
}
