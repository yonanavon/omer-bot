import { NextResponse } from "next/server";
import { whatsapp } from "@/lib/whatsapp";

export async function POST() {
  try {
    await whatsapp.connect();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Connect error:", err);
    return NextResponse.json({ error: "Failed to connect" }, { status: 500 });
  }
}
