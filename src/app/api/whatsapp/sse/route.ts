import { whatsapp } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      // Send initial state
      send("status", { status: whatsapp.getStatus() });
      const qr = whatsapp.getQR();
      if (qr) send("qr", { qr });

      const onStatus = (status: string) => send("status", { status });
      const onQR = (qr: string) => send("qr", { qr });
      const onMembersUpdated = () => send("members-updated", {});
      const onMemberJoined = (data: unknown) => send("member-joined", data);

      whatsapp.on("status", onStatus);
      whatsapp.on("qr", onQR);
      whatsapp.on("members-updated", onMembersUpdated);
      whatsapp.on("member-joined", onMemberJoined);

      // Keepalive
      const keepalive = setInterval(() => {
        if (closed) {
          clearInterval(keepalive);
          return;
        }
        send("ping", {});
      }, 30000);

      // Cleanup on close
      const cleanup = () => {
        closed = true;
        clearInterval(keepalive);
        whatsapp.off("status", onStatus);
        whatsapp.off("qr", onQR);
        whatsapp.off("members-updated", onMembersUpdated);
        whatsapp.off("member-joined", onMemberJoined);
      };

      // Handle stream cancel
      stream.cancel = async () => cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
