import { prisma } from "./prisma";
import { proto } from "baileys";
import { initAuthCreds, BufferJSON } from "baileys";
import type { AuthenticationCreds, SignalDataTypeMap } from "baileys";

async function writeData(key: string, data: unknown) {
  const serialized = JSON.stringify(data, BufferJSON.replacer);
  await prisma.whatsappSession.upsert({
    where: { key },
    update: { value: serialized },
    create: { key, value: serialized },
  });
}

async function readData(key: string) {
  const row = await prisma.whatsappSession.findUnique({ where: { key } });
  if (!row) return null;
  const raw = typeof row.value === "string" ? row.value : JSON.stringify(row.value);
  return JSON.parse(raw, BufferJSON.reviver);
}

async function removeData(key: string) {
  await prisma.whatsappSession.deleteMany({ where: { key } });
}

export async function usePrismaAuthState() {
  const creds: AuthenticationCreds =
    (await readData("auth-creds")) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(
          type: T,
          ids: string[]
        ) => {
          const data: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const id of ids) {
            const value = await readData(`${type}-${id}`);
            if (value) {
              if (type === "app-state-sync-key") {
                data[id] =
                  proto.Message.AppStateSyncKeyData.fromObject(
                    value
                  ) as SignalDataTypeMap[T];
              } else {
                data[id] = value;
              }
            }
          }
          return data;
        },
        set: async (data: Record<string, Record<string, unknown>>) => {
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) {
                await writeData(key, value);
              } else {
                await removeData(key);
              }
            }
          }
        },
      },
    },
    saveCreds: () => writeData("auth-creds", creds),
  };
}
