import fs from "fs";
import path from "path";
import { DEFAULT_SERVICES, DEFAULT_SETTINGS } from "../src/data/defaultServices";

const isVercel = !!process.env.VERCEL;
const dbDir = isVercel ? "/tmp" : path.join(process.cwd(), "data");
const dbFile = path.join(dbDir, "local_db.json");

// In-Memory map for 100% immediate synchronous availability across all environments
const memoryStore = new Map<string, Map<string, any>>();

function getColMap(collection: string): Map<string, any> {
  if (!memoryStore.has(collection)) {
    memoryStore.set(collection, new Map<string, any>());
  }
  return memoryStore.get(collection)!;
}

// Known admin and user profiles to guarantee instant access with full balance
const INITIAL_USERS: Record<string, any> = {
  "mtasvir375@gmail.com": {
    email: "mtasvir375@gmail.com",
    userEmail: "mtasvir375@gmail.com",
    displayName: "Tasvir",
    role: "admin",
    balance: 17702.85,
    createdAt: new Date().toISOString()
  },
  "5LRJPrkW5vVimfCFKGbzTKhXtji2": {
    uid: "5LRJPrkW5vVimfCFKGbzTKhXtji2",
    id: "5LRJPrkW5vVimfCFKGbzTKhXtji2",
    email: "mdsarfarajalam727712@gmail.com",
    userEmail: "mdsarfarajalam727712@gmail.com",
    displayName: "Sarfaraj Alam",
    role: "admin",
    balance: 5000,
    createdAt: new Date().toISOString()
  },
  "UlsK3PLAGHdiSZAhx58Cb23FXLq2": {
    uid: "UlsK3PLAGHdiSZAhx58Cb23FXLq2",
    id: "UlsK3PLAGHdiSZAhx58Cb23FXLq2",
    email: "mdtasvir888@gmail.com",
    userEmail: "mdtasvir888@gmail.com",
    displayName: "Tasvir",
    role: "admin",
    balance: 10000,
    createdAt: new Date().toISOString()
  }
};

let isInitialized = false;

function loadDbFromDisk() {
  if (isInitialized) return;
  isInitialized = true;
  try {
    if (fs.existsSync(dbFile)) {
      const raw = fs.readFileSync(dbFile, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        for (const [col, docs] of Object.entries(parsed)) {
          const colMap = getColMap(col);
          if (docs && typeof docs === "object") {
            for (const [id, doc] of Object.entries(docs as any)) {
              colMap.set(id, doc);
            }
          }
        }
      }
    }
  } catch (e) {}

  seedDefaults();
}

function saveDbToDisk() {
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const serialized: Record<string, Record<string, any>> = {};
    for (const [col, map] of memoryStore.entries()) {
      serialized[col] = {};
      for (const [id, doc] of map.entries()) {
        serialized[col][id] = doc;
      }
    }
    fs.writeFileSync(dbFile, JSON.stringify(serialized, null, 2), "utf-8");
  } catch (e) {}
}

function seedDefaults() {
  // 1. Seed courses if empty
  const courseCol = getColMap("courses");
  if (courseCol.size === 0) {
    for (const service of DEFAULT_SERVICES) {
      setLocalDoc("courses", service.id, {
        ...service,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  }

  // 2. Seed settings/payment if empty
  const paymentSettings = getLocalDoc("settings", "payment");
  if (!paymentSettings || Object.keys(paymentSettings).length === 0) {
    setLocalDoc("settings", "payment", {
      ...DEFAULT_SETTINGS,
      upiId: "9122557342@ybl",
      merchantName: "Pyare SMM Panel",
      minDeposit: 10,
      qrCodeImage: "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=upi://pay?pa=9122557342@ybl&pn=Pyaresmm",
      enableUpi: true,
      enableTelegramBot: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  // 3. Seed initial users if missing
  for (const [key, userProfile] of Object.entries(INITIAL_USERS)) {
    const existing = getLocalDoc("users", key);
    if (!existing) {
      setLocalDoc("users", key, userProfile);
    }
  }
}

// Initialize on module load
loadDbFromDisk();

export async function getLocalSqliteDb(): Promise<any> {
  return {
    run: () => {},
    export: () => Buffer.from(""),
    prepare: () => ({
      bind: () => {},
      step: () => false,
      getAsObject: () => ({}),
      run: () => {},
      free: () => {}
    })
  };
}

export function getLocalDoc(collection: string, id: string): any {
  loadDbFromDisk();
  const colMap = getColMap(collection);
  if (colMap.has(id)) {
    return colMap.get(id);
  }

  // Check email match for users
  if (collection === "users") {
    for (const user of colMap.values()) {
      if (user.email && user.email.toLowerCase() === id.toLowerCase()) {
        return user;
      }
    }
  }
  return null;
}

export function setLocalDoc(collection: string, id: string, data: any): boolean {
  loadDbFromDisk();
  try {
    const now = new Date().toISOString();
    const existing = getLocalDoc(collection, id) || {};
    const merged = { ...existing, ...data, id, updatedAt: data?.updatedAt || now };

    getColMap(collection).set(id, merged);

    if (collection === "users" && merged.email) {
      getColMap(collection).set(merged.email.toLowerCase(), merged);
    }

    saveDbToDisk();
    return true;
  } catch (err: any) {
    return false;
  }
}

export function updateLocalDoc(collection: string, id: string, data: any): boolean {
  return setLocalDoc(collection, id, data);
}

export function addLocalDoc(collection: string, data: any): string {
  const prefix = collection === "orders" ? "ord_" : collection === "deposits" ? "dep_" : collection === "transactions" ? "txn_" : "doc_";
  const id = data.id || (prefix + Date.now() + "_" + Math.random().toString(36).substring(2, 7));
  const now = new Date().toISOString();
  const docData = { id, ...data, createdAt: data.createdAt || now, updatedAt: now };
  setLocalDoc(collection, id, docData);
  return id;
}

export function listLocalDocs(collection: string, limitCount = 300): any[] {
  loadDbFromDisk();
  const colMap = getColMap(collection);
  if (colMap.size > 0) {
    const list = Array.from(colMap.values());
    const unique = new Map<string, any>();
    for (const item of list) {
      const key = item.id || item.uid || JSON.stringify(item);
      if (!unique.has(key)) unique.set(key, item);
    }
    const result = Array.from(unique.values());
    result.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
    return result.slice(0, limitCount);
  }
  return [];
}

export function queryLocalDocs(collection: string, field: string, value: any, limitCount = 50): any[] {
  const all = listLocalDocs(collection, 500);
  const matched = all.filter(doc => String(doc[field]).toLowerCase() === String(value).toLowerCase());
  return matched.slice(0, limitCount);
}

export function deleteLocalDoc(collection: string, id: string): boolean {
  loadDbFromDisk();
  try {
    getColMap(collection).delete(id);
    saveDbToDisk();
    return true;
  } catch (err: any) {
    return false;
  }
}
