import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isLidUser,
  getBinaryNodeChildren,
  getBinaryNodeChild,
} from "baileys";
import { Boom } from "@hapi/boom";
import { EventEmitter } from "events";
import { usePrismaAuthState } from "./whatsapp-auth-store";
import { prisma } from "./prisma";
import * as QRCode from "qrcode";

type Status = "disconnected" | "connecting" | "qr" | "connected";

interface CommunityInfo {
  jid: string;
  name: string;
  announceGroupJid: string | null;
}

class WhatsAppService extends EventEmitter {
  private socket: ReturnType<typeof makeWASocket> | null = null;
  private status: Status = "disconnected";
  private qr: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private monitoredCommunities: Map<string, CommunityInfo> = new Map();

  getStatus() {
    return this.status;
  }

  getQR() {
    return this.qr;
  }

  private setStatus(status: Status) {
    this.status = status;
    this.emit("status", status);
  }

  async connect() {
    if (this.status === "connected" || this.status === "connecting") return;
    this.setStatus("connecting");
    this.reconnectAttempts = 0;

    try {
      const { state, saveCreds } = await usePrismaAuthState();
      const { version } = await fetchLatestBaileysVersion();

      const socket = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, undefined as never),
        },
        browser: ["Omer Bot", "Chrome", "1.0.0"],
        generateHighQualityLinkPreview: false,
        printQRInTerminal: false,
      });

      this.socket = socket;

      socket.ev.on("creds.update", saveCreds);

      socket.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qr = await QRCode.toDataURL(qr);
          this.setStatus("qr");
          this.emit("qr", this.qr);
        }

        if (connection === "close") {
          this.qr = null;
          const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;

          if (reason === DisconnectReason.loggedOut) {
            console.log("[WhatsApp] Logged out - clearing session");
            await prisma.whatsappSession.deleteMany();
            this.setStatus("disconnected");
          } else if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
            console.log(
              `[WhatsApp] Reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms`
            );
            setTimeout(() => this.connect(), delay);
          } else {
            console.log("[WhatsApp] Max reconnect attempts reached");
            this.setStatus("disconnected");
          }
        }

        if (connection === "open") {
          console.log("[WhatsApp] Connected!");
          this.qr = null;
          this.reconnectAttempts = 0;
          this.setStatus("connected");
          await this.discoverCommunities();
        }
      });

      // Listen for participant changes in community announcement groups
      socket.ev.on("group-participants.update", async (event) => {
        await this.handleParticipantUpdate({
          id: event.id,
          participants: event.participants.map((p) => ({
            id: p.id,
            phoneNumber: p.phoneNumber,
            lid: p.lid,
          })),
          action: event.action,
        });
      });
    } catch (err) {
      console.error("[WhatsApp] Connection error:", err);
      this.setStatus("disconnected");
    }
  }

  private async discoverCommunities() {
    if (!this.socket) return;

    try {
      const groups = await this.socket.groupFetchAllParticipating();
      this.monitoredCommunities.clear();

      for (const [jid, metadata] of Object.entries(groups)) {
        if ((metadata as unknown as Record<string, unknown>).isCommunityAnnounce) {
          const parentJid = (metadata as unknown as Record<string, unknown>).linkedParent as string | undefined;
          if (parentJid) {
            this.monitoredCommunities.set(jid, {
              jid: parentJid,
              name: metadata.subject || "Unknown Community",
              announceGroupJid: jid,
            });
            console.log(
              `[WhatsApp] Monitoring community: ${metadata.subject} (announce group: ${jid})`
            );
          }
        }
      }

      console.log(
        `[WhatsApp] Found ${this.monitoredCommunities.size} communities to monitor`
      );

      // Sync existing members from all monitored announcement groups
      for (const [announceJid, community] of this.monitoredCommunities) {
        await this.syncCommunityMembers(announceJid, community);
      }
    } catch (err) {
      console.error("[WhatsApp] Error discovering communities:", err);
    }
  }

  /**
   * Extract phone number from a JID or phoneNumber field.
   */
  private extractPhone(jid: string, phoneNumber?: string): string | null {
    if (phoneNumber) {
      const pn = phoneNumber.replace(/@.*$/, "");
      if (/^\d+$/.test(pn)) return pn;
    }
    if (!isLidUser(jid)) {
      const num = jid.replace(/@.*$/, "");
      if (/^\d+$/.test(num)) return num;
    }
    return null;
  }

  /**
   * Fetch raw group participant data to extract phone_number attributes
   * that Baileys' groupMetadata parser ignores.
   */
  private async fetchRawParticipantPhones(groupJid: string): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (!this.socket) return result;

    try {
      // Send raw IQ query - same as groupMetadata but we parse the raw response
      const rawResult = await (this.socket as unknown as { query: (node: unknown) => Promise<unknown> }).query({
        tag: "iq",
        attrs: {
          type: "get",
          xmlns: "w:g2",
          to: groupJid,
        },
        content: [{ tag: "query", attrs: { request: "interactive" } }],
      });

      const groupNode = getBinaryNodeChild(rawResult as Parameters<typeof getBinaryNodeChild>[0], "group");
      if (!groupNode) return result;

      const participants = getBinaryNodeChildren(groupNode, "participant");

      // Debug: log first 3 raw participant attrs
      console.log(
        "[WhatsApp] Raw participant attrs sample:",
        participants.slice(0, 3).map((p) => JSON.stringify(p.attrs))
      );

      for (const p of participants) {
        const attrs = p.attrs as Record<string, string>;
        const jid = attrs.jid;
        const phoneNumber = attrs.phone_number;

        if (jid && phoneNumber && /^\d+@/.test(phoneNumber)) {
          result.set(jid, phoneNumber.replace(/@.*$/, ""));
        } else if (jid && phoneNumber && /^\d+$/.test(phoneNumber)) {
          result.set(jid, phoneNumber);
        }
      }
    } catch (err) {
      console.error("[WhatsApp] Raw participant fetch error:", err);
    }

    console.log(`[WhatsApp] Raw query resolved ${result.size} phone numbers`);
    return result;
  }

  private async syncCommunityMembers(
    announceJid: string,
    community: CommunityInfo
  ) {
    if (!this.socket) return;

    try {
      const metadata = await this.socket.groupMetadata(announceJid);
      const participants = metadata.participants || [];

      // Fetch raw participant data to get phone_number attrs
      const lidToPhone = await this.fetchRawParticipantPhones(announceJid);

      let newCount = 0;
      let unresolvedCount = 0;
      for (const participant of participants) {
        const lid = isLidUser(participant.id) ? participant.id : (participant.lid || null);
        const jid = participant.id;

        let phoneNumber = this.extractPhone(participant.id, participant.phoneNumber);
        if (!phoneNumber && isLidUser(participant.id)) {
          phoneNumber = lidToPhone.get(participant.id) || null;
        }

        if (!phoneNumber) {
          unresolvedCount++;
        }

        try {
          await prisma.communityMember.upsert({
            where: { jid },
            update: { active: true, communityId: community.jid, ...(phoneNumber && { phoneNumber }), lid },
            create: {
              jid,
              phoneNumber: phoneNumber || participant.id.replace(/@.*$/, ""),
              lid,
              communityId: community.jid,
              joinedAt: new Date(),
            },
          });
          newCount++;
        } catch {
          // Skip duplicates
        }
      }
      console.log(
        `[WhatsApp] Synced ${newCount} members from community: ${community.name}` +
        (unresolvedCount > 0 ? ` (${unresolvedCount} unresolved LIDs)` : "")
      );

      this.emit("members-updated");
    } catch (err) {
      console.error(
        `[WhatsApp] Error syncing community ${community.name}:`,
        err
      );
    }
  }

  private async handleParticipantUpdate(event: {
    id: string;
    participants: { id: string; phoneNumber?: string; lid?: string }[];
    action: string;
  }) {
    const community = this.monitoredCommunities.get(event.id);
    if (!community) return; // Not a monitored announcement group

    console.log(
      `[WhatsApp] Community participant update: ${event.action} in ${community.name}`,
      event.participants
    );

    for (const participant of event.participants) {
      const participantJid = participant.id;
      const lid = isLidUser(participantJid) ? participantJid : (participant.lid || null);
      const phoneNumber = this.extractPhone(participantJid, participant.phoneNumber)
        || participantJid.replace(/@.*$/, "");

      if (event.action === "add") {
        try {
          await prisma.communityMember.upsert({
            where: { jid: participantJid },
            update: { active: true, communityId: community.jid, phoneNumber, lid },
            create: {
              jid: participantJid,
              phoneNumber,
              lid,
              communityId: community.jid,
              joinedAt: new Date(),
            },
          });
          console.log(
            `[WhatsApp] New member joined community ${community.name}: ${phoneNumber}`
          );
          this.emit("member-joined", {
            phoneNumber,
            jid: participantJid,
            communityName: community.name,
          });
          this.emit("members-updated");
        } catch (err) {
          console.error("[WhatsApp] Error saving new member:", err);
        }
      } else if (event.action === "remove") {
        try {
          await prisma.communityMember.updateMany({
            where: { jid: participantJid },
            data: { active: false },
          });
          console.log(
            `[WhatsApp] Member left community ${community.name}: ${phoneNumber}`
          );
          this.emit("member-left", {
            phoneNumber,
            jid: participantJid,
            communityName: community.name,
          });
          this.emit("members-updated");
        } catch (err) {
          console.error("[WhatsApp] Error updating member:", err);
        }
      }
    }
  }

  async getCommunities(): Promise<CommunityInfo[]> {
    return Array.from(this.monitoredCommunities.values());
  }

  async getMembers(communityId?: string) {
    const where: Record<string, unknown> = { active: true };
    if (communityId) where.communityId = communityId;
    return prisma.communityMember.findMany({
      where,
      orderBy: { joinedAt: "desc" },
    });
  }

  async logout() {
    try {
      if (this.socket) {
        await this.socket.logout();
        this.socket = null;
      }
    } catch {
      this.socket = null;
    }
    await prisma.whatsappSession.deleteMany();
    this.monitoredCommunities.clear();
    this.qr = null;
    this.setStatus("disconnected");
  }

  async disconnect() {
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
    this.monitoredCommunities.clear();
    this.qr = null;
    this.setStatus("disconnected");
  }
}

// Singleton - must persist across requests in all environments
const globalForWhatsApp = globalThis as unknown as {
  whatsapp: WhatsAppService | undefined;
};

export const whatsapp =
  globalForWhatsApp.whatsapp ?? new WhatsAppService();

globalForWhatsApp.whatsapp = whatsapp;
