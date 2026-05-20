import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ sessionId: crypto.randomUUID() });
}
