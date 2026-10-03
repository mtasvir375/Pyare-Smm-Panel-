import fs from "fs";
import path from "path";

const DEFAULT_SERVICES: any[] = [
  {
    id: "srv_ig_followers_nondrop",
    title: "Instagram Followers [Non-Drop] [Lifetime Guarantee] [Super Fast]",
    category: "Instagram",
    pricePerThousand: 65,
    price: 65,
    minLimit: 100,
    maxLimit: 100000,
    status: "active",
    providerId: "talVdnSEg8QGpNVpaUTi",
    providerServiceId: "101"
  },
  {
    id: "srv_ig_likes_hq",
    title: "Instagram Real Likes [HQ] [Fast Start] [Non-Drop]",
    category: "Instagram",
    pricePerThousand: 18,
    price: 18,
    minLimit: 50,
    maxLimit: 50000,
    status: "active",
    providerId: "talVdnSEg8QGpNVpaUTi",
    providerServiceId: "102"
  },
  {
    id: "srv_ig_views_viral",
    title: "Instagram Reels Views [Instant Speed] [Explore High Reach]",
    category: "Instagram",
    pricePerThousand: 10.5,
    price: 10.5,
    minLimit: 200,
    maxLimit: 1000000,
    status: "active",
    providerId: "z9lfdj7ByNCeGNO6WbGZ",
    providerServiceId: "4545"
  }
];

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
  "c4w6bjFk9leTy9SR2ijM0YyJVfx1": {
    uid: "c4w6bjFk9leTy9SR2ijM0YyJVfx1",
    id: "c4w6bjFk9leTy9SR2ijM0YyJVfx1",
    email: "mtasvir375@gmail.com",
    userEmail: "mtasvir375@gmail.com",
    displayName: "Tasvir",
    role: "admin",
    balance: 16751.25,
    createdAt: new Date().toISOString()
  },
  "5LRJPrkW5vVimfCFKGbzTKhXtji2": {
    uid: "5LRJPrkW5vVimfCFKGbzTKhXtji2",
    id: "5LRJPrkW5vVimfCFKGbzTKhXtji2",
    email: "mdsarfarajalam727712@gmail.com",
    userEmail: "mdsarfarajalam727712@gmail.com",
    displayName: "Sarfaraj Alam",
    role: "admin",
    balance: 1,
    createdAt: new Date().toISOString()
  },
  "UlsK3PLAGHdiSZAhx58Cb23FXLq2": {
    uid: "UlsK3PLAGHdiSZAhx58Cb23FXLq2",
    id: "UlsK3PLAGHdiSZAhx58Cb23FXLq2",
    email: "mdtasvir888@gmail.com",
    userEmail: "mdtasvir888@gmail.com",
    displayName: "Tasvir",
    role: "admin",
    balance: 10,
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

  // Deduplicate and cleanup email-keyed users in local db
  try {
    const userCol = getColMap("users");
    const emailKeysToRemove: string[] = [];
    for (const [key, doc] of userCol.entries()) {
      if (key.includes("@")) {
        const canonicalId = (doc && (doc.uid || doc.id)) ? String(doc.uid || doc.id).trim() : "";
        if (canonicalId && canonicalId !== key) {
          const existing = userCol.get(canonicalId) || {};
          userCol.set(canonicalId, { ...existing, ...doc, id: canonicalId, uid: canonicalId });
          emailKeysToRemove.push(key);
        }
      }
    }
    emailKeysToRemove.forEach(k => userCol.delete(k));
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

const DEFAULT_PROVIDERS: Record<string, any> = {
  "talVdnSEg8QGpNVpaUTi": {
    id: "talVdnSEg8QGpNVpaUTi",
    name: "Wholesale Smm Store",
    apiKey: "e88f2599c82bf15a44b759e61f63673ceae954b8",
    apiUrl: "https://wholesalesmmstore.com/api/v2",
    createdAt: "2026-09-05T23:14:00.000Z"
  },
  "z4luhVVgYKgHULKPXj8j": {
    id: "z4luhVVgYKgHULKPXj8j",
    name: "The main smm provider",
    apiKey: "e104906e7686a6177f614c7ddbe0a240124a1795",
    apiUrl: "https://themainsmmprovider.com/api/v2",
    createdAt: "2026-09-05T23:14:00.000Z"
  },
  "z9lfdj7ByNCeGNO6WbGZ": {
    id: "z9lfdj7ByNCeGNO6WbGZ",
    name: "Smm bin",
    apiKey: "f55bb2dfdc035f9c3c9e737bb72922a51d64309f",
    apiUrl: "https://smmbin.com/api/v2",
    createdAt: "2026-09-05T23:14:00.000Z"
  },
  "1RmzJhc5ZeyOCU23uZMy": {
    id: "1RmzJhc5ZeyOCU23uZMy",
    name: "MainSMMpanel ♥️",
    apiKey: "5a2749e1fdafdf50cd81f2137f9b5806",
    apiUrl: "https://mainsmmpanel.in/api/v2",
    createdAt: "2026-09-05T23:14:00.000Z"
  }
};

function seedDefaults() {
  const isFirstRun = !fs.existsSync(dbFile);

  // 1. Seed courses ONLY on first brand new run if empty
  const courseCol = getColMap("courses");
  if (courseCol.size === 0 && DEFAULT_SERVICES.length > 0) {
    for (const service of DEFAULT_SERVICES) {
      setLocalDoc("courses", service.id, {
        ...service,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  }

  // 2. Seed providers if empty
  const providerCol = getColMap("providers");
  if (providerCol.size === 0) {
    for (const [pId, pData] of Object.entries(DEFAULT_PROVIDERS)) {
      setLocalDoc("providers", pId, pData);
    }
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
    let targetId = id;

    // For users, ensure we always key by canonical UID rather than email
    if (collection === "users") {
      const canonicalUid = data?.uid || data?.id;
      if (canonicalUid && !String(canonicalUid).includes("@")) {
        targetId = String(canonicalUid).trim();
      }
    }

    const existing = getLocalDoc(collection, targetId) || {};
    const merged = { ...existing, ...data, id: targetId, updatedAt: data?.updatedAt || now };

    getColMap(collection).set(targetId, merged);

    // If an email-keyed document existed previously, remove it to prevent double listing
    if (collection === "users" && id !== targetId && id.includes("@")) {
      getColMap(collection).delete(id);
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
    const seenEmails = new Set<string>();
    const seenUids = new Set<string>();

    for (const item of list) {
      if (!item) continue;
      if (collection === "users") {
        const uid = String(item.uid || item.id || "").trim();
        const email = String(item.email || item.userEmail || "").trim().toLowerCase();
        if (uid && seenUids.has(uid)) continue;
        if (email && seenEmails.has(email)) continue;
        if (uid) seenUids.add(uid);
        if (email) seenEmails.add(email);
        unique.set(uid || email || String(Math.random()), item);
      } else {
        const key = item.id || item.uid || JSON.stringify(item);
        if (!unique.has(key)) unique.set(key, item);
      }
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

export default function handler(req: any, res: any) {
  if (res && typeof res.status === "function") {
    return res.status(200).json({ status: "ok", message: "localDb ready" });
  }
}

