import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  USyncQuery,
  USyncUser,
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
   * Resolve LID JIDs to real phone numbers using USync query.
   * Returns a map of LID -> phone number.
   */
  private async resolveLIDsToPhones(lids: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (!this.socket || lids.length === 0) return result;

    try {
      const query = new USyncQuery().withContactProtocol().withContext("interactive");
      for (const lid of lids) {
        query.withUser(new USyncUser().withId(lid));
      }

      const response = await this.socket.executeUSyncQuery(query);
      if (response?.list) {
        for (const item of response.list) {
          // item.id is the JID returned by WhatsApp (could be the real phone JID)
          // If the returned ID is a phone number JID (not LID), extract the number
          if (item.id && !item.id.includes("@lid")) {
            const phone = item.id.replace(/@.*$/, "");
            // Find which LID this corresponds to - match by position or by the query
            if (phone && /^\d+$/.test(phone)) {
              // We need to find the original LID for this result
              // USync returns results in same order as users
              result.set(lids[response.list.indexOf(item)], phone);
            }
          }
        }
      }
    } catch (err) {
      console.error("[WhatsApp] Error resolving LIDs to phone numbers:", err);
    }

    return result;
  }

  /**
   * Extract phone number from a participant, handling LID cases.
   * Returns the phone number string or null if it's a LID that needs resolution.
   */
  private extractPhoneNumber(
    participantId: string,
    phoneNumber?: string
  ): string | null {
    // If Baileys provided a phone number directly, use it
    const pn = phoneNumber?.replace("@s.whatsapp.net", "");
    if (pn && /^\d+$/.test(pn)) return pn;

    // If the ID is a regular phone JID, extract the number
    if (!participantId.includes("@lid")) {
      return participantId.replace(/@.*$/, "");
    }

    // It's a LID without a phone number - needs resolution
    return null;
  }

  private async syncCommunityMembers(
    announceJid: string,
    community: CommunityInfo
  ) {
    if (!this.socket) return;

    try {
      const metadata = await this.socket.groupMetadata(announceJid);
      const participants = metadata.participants || [];

      // Collect LID participants that need phone number resolution
      const lidParticipants: string[] = [];
      for (const participant of participants) {
        const phone = this.extractPhoneNumber(participant.id, participant.phoneNumber);
        if (phone === null) {
          lidParticipants.push(participant.id);
        }
      }

      // Batch resolve LIDs to phone numbers
      const lidToPhone = await this.resolveLIDsToPhones(lidParticipants);

      let newCount = 0;
      for (const participant of participants) {
        const isLid = participant.id.includes("@lid");
        let phoneNumber = this.extractPhoneNumber(participant.id, participant.phoneNumber);

        // Try resolved LID mapping
        if (phoneNumber === null && isLid) {
          phoneNumber = lidToPhone.get(participant.id) || null;
        }

        const lid = isLid ? participant.id : (participant.lid || null);
        const jid = participant.id;

        // If we still don't have a phone number, store the LID number as fallback
        // but mark it so we can identify it later
        if (phoneNumber === null) {
          phoneNumber = participant.id.replace(/@.*$/, "");
          console.log(
            `[WhatsApp] Could not resolve phone for LID participant: ${participant.id}`
          );
        }

        try {
          await prisma.communityMember.upsert({
            where: { jid },
            update: { active: true, communityId: community.jid, phoneNumber, lid },
            create: {
              jid,
              phoneNumber,
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
        `[WhatsApp] Synced ${newCount} members from community: ${community.name}`
      );

      // Also try to fix existing members that have LID-based phone numbers
      await this.fixLIDPhoneNumbers();

      this.emit("members-updated");
    } catch (err) {
      console.error(
        `[WhatsApp] Error syncing community ${community.name}:`,
        err
      );
    }
  }

  /**
   * Find members whose phoneNumber looks like a LID (not a real phone number)
   * and try to resolve them.
   */
  private async fixLIDPhoneNumbers() {
    if (!this.socket) return;

    try {
      // Find members with LID-based JIDs that might have wrong phone numbers
      const lidMembers = await prisma.communityMember.findMany({
        where: {
          jid: { endsWith: "@lid" },
          active: true,
        },
      });

      if (lidMembers.length === 0) return;

      const lidsToResolve = lidMembers
        .filter((m) => {
          // Check if the phone number looks like a LID number (not a real phone)
          // Real Israeli numbers start with 972, real numbers are typically 10-15 digits
          // LID numbers are internal IDs that don't follow phone patterns
          return !m.phoneNumber.startsWith("972") && !m.phoneNumber.startsWith("+");
        })
        .map((m) => m.jid);

      if (lidsToResolve.length === 0) return;

      console.log(
        `[WhatsApp] Attempting to resolve ${lidsToResolve.length} LID phone numbers...`
      );

      const lidToPhone = await this.resolveLIDsToPhones(lidsToResolve);

      for (const [lid, phone] of lidToPhone) {
        await prisma.communityMember.updateMany({
          where: { jid: lid },
          data: { phoneNumber: phone },
        });
        console.log(`[WhatsApp] Fixed phone number for LID ${lid}: ${phone}`);
      }

      if (lidToPhone.size > 0) {
        console.log(
          `[WhatsApp] Fixed ${lidToPhone.size} LID phone numbers`
        );
      }
    } catch (err) {
      console.error("[WhatsApp] Error fixing LID phone numbers:", err);
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
      const isLid = participantJid.includes("@lid");
      let phoneNumber = this.extractPhoneNumber(participantJid, participant.phoneNumber);

      // Try to resolve LID to phone number
      if (phoneNumber === null && isLid) {
        const resolved = await this.resolveLIDsToPhones([participantJid]);
        phoneNumber = resolved.get(participantJid) || null;
      }

      // Fallback: use the raw JID number if we still couldn't resolve
      if (phoneNumber === null) {
        phoneNumber = participantJid.replace(/@.*$/, "");
      }

      const lid = isLid ? participantJid : (participant.lid || null);

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
