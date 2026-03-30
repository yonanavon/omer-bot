import { NextResponse } from "next/server";
import { whatsapp } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: whatsapp.getStatus(),
    qr: whatsapp.getQR(),
  });
}
