import { NextResponse } from "next/server";
import { whatsapp } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const communityId = searchParams.get("communityId") || undefined;
    const members = await whatsapp.getMembers(communityId);
    return NextResponse.json(members);
  } catch (err) {
    console.error("Members error:", err);
    return NextResponse.json(
      { error: "Failed to fetch members" },
      { status: 500 }
    );
  }
}
