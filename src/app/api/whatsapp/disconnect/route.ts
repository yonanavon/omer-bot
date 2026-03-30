import { NextResponse } from "next/server";
import { whatsapp } from "@/lib/whatsapp";

export async function POST() {
  try {
    await whatsapp.logout();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Disconnect error:", err);
    return NextResponse.json(
      { error: "Failed to disconnect" },
      { status: 500 }
    );
  }
}
