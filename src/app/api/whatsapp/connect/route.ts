import { NextResponse } from "next/server";
import { whatsapp } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    console.log("[API] Connect request received, current status:", whatsapp.getStatus());
    await whatsapp.connect();
    console.log("[API] Connect initiated, status:", whatsapp.getStatus());
    return NextResponse.json({ success: true, status: whatsapp.getStatus() });
  } catch (err) {
    console.error("[API] Connect error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
