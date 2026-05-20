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

interface ClientPayload {
  id: string;
  name: string;
  status: string;
  mrr: number;
}

async function runSummarize(sessionId: string, client: ClientPayload) {
  // Reset previous insights so the panel shows just this client.
  publish(sessionId, event(sessionId, { op: "ui.reset" }));

  publish(sessionId, event(sessionId, {
    op: "ui.append",
    node: {
      key: `msg-${client.id}`,
      type: "tool.agent-msg",
      props: { text: `Pulling insights for ${client.name}...` },
    },
  }));

  await new Promise((r) => setTimeout(r, 400));

  const insights: Array<{ title: string; body: string }> = [
    {
      title: `${client.name} — status: ${client.status}`,
      body:
        client.status === "active"
          ? `Active subscription. MRR $${client.mrr.toLocaleString()}/mo.`
          : client.status === "lead"
            ? "Lead in pipeline. No MRR yet."
            : "Churned. Consider win-back outreach.",
    },
    {
      title: "Recent activity",
      body: "Last login: 3 days ago. Three open support tickets.",
    },
    {
      title: "Recommended action",
      body:
        client.status === "active" && client.mrr > 10_000
          ? "Schedule a QBR — this account is in the top 20%."
          : client.status === "lead"
            ? "Send the onboarding nurture sequence."
            : "Survey for churn reason before win-back.",
    },
  ];

  for (const ins of insights) {
    publish(sessionId, event(sessionId, {
      op: "ui.append",
      node: {
        key: `ins-${client.id}-${ins.title}`,
        type: "tool.insight-card",
        props: ins,
      },
    }));
    await new Promise((r) => setTimeout(r, 120));
  }
}

export async function POST(req: NextRequest, ctx: ActionCtx) {
  const { sessionId } = await ctx.params;
  const action = (await req.json()) as {
    name?: string;
    payload?: { client?: ClientPayload };
  };

  if (action.name === "client.summarize" && action.payload?.client) {
    void runSummarize(sessionId, action.payload.client);
  }

  return NextResponse.json({ ok: true });
}
