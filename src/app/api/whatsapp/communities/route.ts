import { NextResponse } from "next/server";
import { whatsapp } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const communities = await whatsapp.getCommunities();
    return NextResponse.json(communities);
  } catch (err) {
    console.error("Communities error:", err);
    return NextResponse.json(
      { error: "Failed to fetch communities" },
      { status: 500 }
    );
  }
}
