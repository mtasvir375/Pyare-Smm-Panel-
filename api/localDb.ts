import fs from "fs";
import path from "path";
import initSqlJs, { Database } from "sql.js";
import { DEFAULT_SERVICES, DEFAULT_SETTINGS } from "../src/data/defaultServices";

let dbInstance: Database | null = null;
let sqlEngine: any = null;
const isVercel = !!process.env.VERCEL;
const dbDir = isVercel ? "/tmp" : path.join(process.cwd(), "data");
const dbPath = path.join(dbDir, "app.db");
const seedDbPath = path.join(process.cwd(), "data", "app.db");

// In-Memory map fallback for 100% immediate synchronous availability across all environments
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

export async function getLocalSqliteDb(): Promise<Database> {
  if (dbInstance) return dbInstance;

  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  } catch (e) {}

  if (!sqlEngine) {
    sqlEngine = await initSqlJs();
  }

  let sourceBuffer: Buffer | null = null;
  if (fs.existsSync(dbPath)) {
    try { sourceBuffer = fs.readFileSync(dbPath); } catch (e) {}
  } else if (fs.existsSync(seedDbPath)) {
    try { sourceBuffer = fs.readFileSync(seedDbPath); } catch (e) {}
  }

  if (sourceBuffer) {
    try {
      dbInstance = new sqlEngine.Database(sourceBuffer);
      loadSqliteIntoMemory();
    } catch (e) {
      dbInstance = new sqlEngine.Database();
    }
  } else {
    dbInstance = new sqlEngine.Database();
  }

  // Create document table if it doesn't exist
  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS documents (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS idx_col ON documents(collection);
  `);

  saveDbToDisk();
  seedDefaults();
  return dbInstance;
}

function loadSqliteIntoMemory() {
  if (!dbInstance) return;
  try {
    const stmt = dbInstance.prepare("SELECT collection, id, data FROM documents");
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (row.collection && row.id && row.data) {
        try {
          const parsed = JSON.parse(String(row.data));
          getColMap(String(row.collection)).set(String(row.id), parsed);
        } catch (e) {}
      }
    }
    stmt.free();
  } catch (e) {}
}

function saveDbToDisk() {
  if (!dbInstance) return;
  try {
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (err: any) {}
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

export function getLocalDoc(collection: string, id: string): any {
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

  if (dbInstance) {
    try {
      const stmt = dbInstance.prepare("SELECT data FROM documents WHERE collection = ? AND id = ?");
      stmt.bind([collection, String(id)]);
      let result: any = null;
      if (stmt.step()) {
        const row = stmt.getAsObject();
        if (row.data) {
          result = JSON.parse(String(row.data));
          colMap.set(id, result);
        }
      }
      stmt.free();
      return result;
    } catch (err: any) {}
  }
  return null;
}

export function setLocalDoc(collection: string, id: string, data: any): boolean {
  try {
    const now = new Date().toISOString();
    const existing = getLocalDoc(collection, id) || {};
    const merged = { ...existing, ...data, id, updatedAt: data?.updatedAt || now };

    getColMap(collection).set(id, merged);

    // If user has email, also index by email
    if (collection === "users" && merged.email) {
      getColMap(collection).set(merged.email.toLowerCase(), merged);
    }

    if (dbInstance) {
      const stmt = dbInstance.prepare(`
        INSERT OR REPLACE INTO documents (collection, id, data, updated_at)
        VALUES (?, ?, ?, ?)
      `);
      stmt.run([collection, String(id), JSON.stringify(merged), now]);
      stmt.free();
      saveDbToDisk();
    }
    return true;
  } catch (err: any) {
    console.error(`[SQLITE-SET-ERR] ${collection}/${id}:`, err.message);
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
  const colMap = getColMap(collection);
  if (colMap.size > 0) {
    const list = Array.from(colMap.values());
    // Filter duplicates if any
    const unique = new Map<string, any>();
    for (const item of list) {
      const key = item.id || item.uid || JSON.stringify(item);
      if (!unique.has(key)) unique.set(key, item);
    }
    const result = Array.from(unique.values());
    result.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
    return result.slice(0, limitCount);
  }

  if (dbInstance) {
    try {
      const stmt = dbInstance.prepare(`
        SELECT id, data FROM documents WHERE collection = ? ORDER BY rowid DESC LIMIT ?
      `);
      stmt.bind([collection, limitCount]);
      const list: any[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        if (row.data) {
          try {
            const parsed = JSON.parse(String(row.data));
            colMap.set(String(row.id), parsed);
            list.push({ id: row.id, ...parsed });
          } catch (e) {}
        }
      }
      stmt.free();
      return list;
    } catch (err: any) {}
  }
  return [];
}

export function queryLocalDocs(collection: string, field: string, value: any, limitCount = 50): any[] {
  const all = listLocalDocs(collection, 500);
  const matched = all.filter(doc => String(doc[field]).toLowerCase() === String(value).toLowerCase());
  return matched.slice(0, limitCount);
}

export function deleteLocalDoc(collection: string, id: string): boolean {
  try {
    getColMap(collection).delete(id);
    if (dbInstance) {
      const stmt = dbInstance.prepare("DELETE FROM documents WHERE collection = ? AND id = ?");
      stmt.run([collection, String(id)]);
      stmt.free();
      saveDbToDisk();
    }
    return true;
  } catch (err: any) {
    return false;
  }
}
