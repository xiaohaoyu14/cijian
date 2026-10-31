import { openDB } from "idb";

// Separate from learning data and exports: connection credentials never enter backups.
const vault = openDB("cijian-vault-v1", 1, { upgrade(db) { db.createObjectStore("private"); } });
export interface CloudConnection { url: string; token: string }
export async function deviceInfo() {
  const db = await vault;
  let device = await db.get("private", "device") as { id: string; name: string } | undefined;
  if (!device) { device = { id: crypto.randomUUID(), name: /Android/i.test(navigator.userAgent) ? "安卓设备" : "电脑设备" }; await db.put("private", device, "device"); }
  return device;
}
export async function renameDevice(name: string) {
  const d = await deviceInfo(); d.name = name.trim().slice(0, 80) || d.name;
  await (await vault).put("private", d, "device"); return d;
}
export const loadConnection = async (): Promise<CloudConnection | undefined> => (await vault).get("private", "cloud");
export const saveConnection = async (connection: CloudConnection) => (await vault).put("private", connection, "cloud");
export const forgetConnection = async () => (await vault).delete("private", "cloud");
export const saveRecovery = async (bytes: Uint8Array) => (await vault).put("private", { at: new Date().toISOString(), bytes }, "recovery");
export const loadRecovery = async (): Promise<{ at: string; bytes: Uint8Array } | undefined> => (await vault).get("private", "recovery");
export const markCloudBackup = async (value: { at: string; id: string }) => (await vault).put("private", value, "last-cloud");
export const lastCloudBackup = async (): Promise<{ at: string; id: string } | undefined> => (await vault).get("private", "last-cloud");
