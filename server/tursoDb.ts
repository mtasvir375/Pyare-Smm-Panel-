import { createClient, Client } from "@libsql/client/web";
import fs from "fs";
import path from "path";

const isVercel = !!process.env.VERCEL;
const configDir = isVercel ? "/tmp" : path.join(process.cwd(), "data");
const configFile = path.join(configDir, "turso_config.json");

interface TursoConfig {
  url: string;
  authToken: string;
  lastSync?: string;
  autoSync?: boolean;
}

let tursoClient: Client | null = null;
const DEFAULT_TURSO_URL = "libsql://pyare-smm-panel-pyaresmmpanel.aws-ap-south-1.turso.io";
const DEFAULT_TURSO_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTEwNjQ0NzgsImlkIjoiMDFhMTAzYzEtNzYwMS03NDk5LTljYWMtYzdkMDExOWU5M2ZkIiwia2lkIjoiYVFCV3BPanpQSVA2czQzcGlrZ29pbkJtVlNodDZOTmh0YndUejBpaDRGOCIsInJpZCI6IjM0MTg2ZDIxLTgwYTUtNDU1YS1hOWQ3LWJhNGQzZTJlNTIzYSJ9.MXelOKfVsMZZoYfKiflhegiqqXQD5-0HN_faUU4z7WtQdjiQQTWXpU-i8jF1DiQrRpFUUV5wol-7dikl8pW5Dw";

let currentConfig: TursoConfig = {
  url: process.env.TURSO_DATABASE_URL || process.env.TURSO_URL || DEFAULT_TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN || process.env.TURSO_TOKEN || DEFAULT_TURSO_TOKEN,
  autoSync: true
};

// Ensure data folder exists
try {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
} catch (e) {}

// Load saved config from disk on startup
export function loadTursoConfigFromDisk(): TursoConfig {
  try {
    if (fs.existsSync(configFile)) {
      const raw = fs.readFileSync(configFile, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        currentConfig = {
          ...currentConfig,
          ...parsed,
          url: parsed.url || currentConfig.url || "",
          authToken: parsed.authToken || currentConfig.authToken || ""
        };
      }
    }
  } catch (e) {
    console.warn("[TURSO] Failed to read turso_config.json:", e);
  }

  // If credentials present, initialize client
  if (currentConfig.url && currentConfig.authToken) {
    initTursoClient(currentConfig.url, currentConfig.authToken);
  }

  return currentConfig;
}

// Initialize or switch Turso client
export function initTursoClient(url: string, authToken: string): Client | null {
  const cleanUrl = (url || "").trim();
  const cleanToken = (authToken || "").trim();

  if (!cleanUrl || !cleanToken) {
    tursoClient = null;
    return null;
  }

  try {
    tursoClient = createClient({
      url: cleanUrl,
      authToken: cleanToken
    });
    console.log(`[TURSO] libSQL client initialized for ${cleanUrl.replace(/:[^:]*@/, ":***@")}`);
    
    // Automatically initialize tables in background
    initTursoTables(tursoClient).catch(err => {
      console.warn("[TURSO] Table initialization notice:", err?.message || err);
    });

    return tursoClient;
  } catch (err: any) {
    console.error("[TURSO] Error initializing libSQL client:", err?.message || err);
    tursoClient = null;
    return null;
  }
}

// Get the active client
export function getTursoClient(): Client | null {
  if (!tursoClient && currentConfig.url && currentConfig.authToken) {
    initTursoClient(currentConfig.url, currentConfig.authToken);
  }
  return tursoClient;
}

// Check if Turso is active & configured
export function isTursoConnected(): boolean {
  return !!tursoClient;
}

// Initialize all necessary tables in Turso SQLite schema
export async function initTursoTables(client: Client): Promise<void> {
  // 1. Universal Documents Table (allows storing ANY JSON collection seamlessly)
  await client.execute(`
    CREATE TABLE IF NOT EXISTS smm_documents (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (collection, id)
    );
  `);

  // 2. Structured Services/Courses Table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS smm_courses (
      id TEXT PRIMARY KEY,
      title TEXT,
      category TEXT,
      price REAL,
      provider_id TEXT,
      provider_service_id TEXT,
      min_limit INTEGER,
      max_limit INTEGER,
      status TEXT,
      data TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 3. Structured Orders Table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS smm_orders (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      course_id TEXT,
      service_id TEXT,
      link TEXT,
      quantity INTEGER,
      charge REAL,
      status TEXT,
      api_order_id TEXT,
      data TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 4. Structured Users Table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS smm_users (
      id TEXT PRIMARY KEY,
      email TEXT,
      role TEXT,
      balance REAL,
      data TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 5. Structured Deposits Table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS smm_deposits (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      amount REAL,
      status TEXT,
      transaction_id TEXT,
      data TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 6. Structured Providers Table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS smm_providers (
      id TEXT PRIMARY KEY,
      name TEXT,
      api_url TEXT,
      api_key TEXT,
      balance REAL,
      status TEXT,
      data TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 7. Settings Table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS smm_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 8. Bot Distributed Polling Lease Table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS smm_bot_lease (
      id TEXT PRIMARY KEY,
      leader_id TEXT NOT NULL,
      heartbeat INTEGER NOT NULL
    );
  `);

  console.log("[TURSO] All database tables verified / created successfully.");
}

/**
 * Acquire or refresh distributed polling lease via atomic SQL
 */
export async function acquireTursoPollingLease(instanceId: string): Promise<boolean> {
  const client = getTursoClient();
  if (!client) return true;
  const now = Date.now();
  const leaseTimeoutMs = 12000;

  try {
    const res = await client.execute({
      sql: `UPDATE smm_bot_lease 
            SET leader_id = ?, heartbeat = ? 
            WHERE id = 'telegram_polling' AND (leader_id = ? OR heartbeat < ?)`,
      args: [instanceId, now, instanceId, now - leaseTimeoutMs]
    });

    if (res.rowsAffected && res.rowsAffected > 0) {
      return true;
    }

    try {
      await client.execute({
        sql: `INSERT INTO smm_bot_lease (id, leader_id, heartbeat) VALUES ('telegram_polling', ?, ?)`,
        args: [instanceId, now]
      });
      return true;
    } catch {
      return false;
    }
  } catch (err: any) {
    return true;
  }
}

// Test credentials and connection
export async function testTursoConnection(url: string, authToken: string): Promise<{ success: boolean; message: string; stats?: any }> {
  try {
    const cleanUrl = (url || "").trim();
    const cleanToken = (authToken || "").trim();

    if (!cleanUrl) {
      return { success: false, message: "Database URL is required (e.g. libsql://your-db.turso.io)" };
    }
    if (!cleanToken) {
      return { success: false, message: "Auth Token is required" };
    }

    const testClient = createClient({
      url: cleanUrl,
      authToken: cleanToken
    });

    // Execute test query
    const res = await testClient.execute("SELECT 1 as connected;");
    if (!res || res.rows.length === 0) {
      return { success: false, message: "Connection test query returned empty response" };
    }

    // Initialize tables to ensure full read/write permissions
    await initTursoTables(testClient);

    // Count existing records if any
    let docCount = 0;
    try {
      const countRes = await testClient.execute("SELECT COUNT(*) as count FROM smm_documents;");
      docCount = Number(countRes.rows[0]?.count || 0);
    } catch (e) {}

    return {
      success: true,
      message: `Turso database connected successfully! (Tables ready, ${docCount} documents found)`,
      stats: { docCount }
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Turso Connection Error: ${err?.message || String(err)}`
    };
  }
}

// Save config permanently to file and re-init
export async function saveTursoConfig(url: string, authToken: string, autoSync: boolean = true): Promise<{ success: boolean; message: string }> {
  try {
    const cleanUrl = (url || "").trim();
    const cleanToken = (authToken || "").trim();

    currentConfig = {
      url: cleanUrl,
      authToken: cleanToken,
      autoSync
    };

    try {
      fs.writeFileSync(configFile, JSON.stringify(currentConfig, null, 2), "utf-8");
    } catch (fsErr) {
      console.warn("[TURSO] Could not write turso_config.json:", fsErr);
    }

    if (cleanUrl && cleanToken) {
      const client = initTursoClient(cleanUrl, cleanToken);
      if (client) {
        await initTursoTables(client);
      }
    } else {
      tursoClient = null;
    }

    return { success: true, message: "Turso configuration saved successfully!" };
  } catch (err: any) {
    return { success: false, message: err?.message || "Failed to save configuration" };
  }
}

// Get public status for Admin Panel
export async function getTursoStatus(): Promise<any> {
  const client = getTursoClient();
  const isConn = !!client;
  let stats: any = {
    documents: 0,
    courses: 0,
    orders: 0,
    users: 0,
    deposits: 0,
    providers: 0
  };

  if (client) {
    try {
      const [docRes, courseRes, orderRes, userRes, depRes, provRes] = await Promise.allSettled([
        client.execute("SELECT COUNT(*) as c FROM smm_documents;"),
        client.execute("SELECT COUNT(*) as c FROM smm_courses;"),
        client.execute("SELECT COUNT(*) as c FROM smm_orders;"),
        client.execute("SELECT COUNT(*) as c FROM smm_users;"),
        client.execute("SELECT COUNT(*) as c FROM smm_deposits;"),
        client.execute("SELECT COUNT(*) as c FROM smm_providers;")
      ]);

      if (docRes.status === "fulfilled") stats.documents = Number(docRes.value.rows[0]?.c || 0);
      if (courseRes.status === "fulfilled") stats.courses = Number(courseRes.value.rows[0]?.c || 0);
      if (orderRes.status === "fulfilled") stats.orders = Number(orderRes.value.rows[0]?.c || 0);
      if (userRes.status === "fulfilled") stats.users = Number(userRes.value.rows[0]?.c || 0);
      if (depRes.status === "fulfilled") stats.deposits = Number(depRes.value.rows[0]?.c || 0);
      if (provRes.status === "fulfilled") stats.providers = Number(provRes.value.rows[0]?.c || 0);
    } catch (e) {}
  }

  return {
    connected: isConn,
    url: currentConfig.url ? currentConfig.url.replace(/:[^:]*@/, ":***@") : "",
    hasToken: !!currentConfig.authToken,
    lastSync: currentConfig.lastSync || null,
    stats
  };
}

// Set / Upsert document into Turso
export async function tursoSetDoc(collection: string, id: string, data: any): Promise<void> {
  const client = getTursoClient();
  if (!client || !collection || !id) return;

  const dataJson = JSON.stringify(data);
  const now = new Date().toISOString();

  try {
    // 1. Universal documents table
    await client.execute({
      sql: `INSERT INTO smm_documents (collection, id, data, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at;`,
      args: [collection, id, dataJson, now]
    });

    // 2. Specialized tables for fast indexing & queries
    if (collection === "courses") {
      await client.execute({
        sql: `INSERT INTO smm_courses (id, title, category, price, provider_id, provider_service_id, min_limit, max_limit, status, data, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                category = excluded.category,
                price = excluded.price,
                provider_id = excluded.provider_id,
                provider_service_id = excluded.provider_service_id,
                min_limit = excluded.min_limit,
                max_limit = excluded.max_limit,
                status = excluded.status,
                data = excluded.data,
                updated_at = excluded.updated_at;`,
        args: [
          id,
          data.title || data.name || "",
          data.category || "General",
          Number(data.pricePerThousand || data.price || 0),
          data.providerId || "",
          String(data.providerServiceId || ""),
          Number(data.minLimit || data.min || 0),
          Number(data.maxLimit || data.max || 0),
          data.status || "active",
          dataJson,
          now
        ]
      });
    } else if (collection === "orders") {
      await client.execute({
        sql: `INSERT INTO smm_orders (id, user_id, course_id, service_id, link, quantity, charge, status, api_order_id, data)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                status = excluded.status,
                api_order_id = excluded.api_order_id,
                data = excluded.data;`,
        args: [
          id,
          data.userId || data.userEmail || "",
          data.courseId || data.serviceId || "",
          String(data.serviceId || data.providerServiceId || ""),
          data.link || "",
          Number(data.quantity || 0),
          Number(data.charge || 0),
          data.status || "pending",
          String(data.apiOrderId || data.providerOrderId || ""),
          dataJson
        ]
      });
    } else if (collection === "users") {
      await client.execute({
        sql: `INSERT INTO smm_users (id, email, role, balance, data, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                email = excluded.email,
                role = excluded.role,
                balance = excluded.balance,
                data = excluded.data,
                updated_at = excluded.updated_at;`,
        args: [
          id,
          data.email || data.userEmail || "",
          data.role || "user",
          Number(data.balance || 0),
          dataJson,
          now
        ]
      });
    } else if (collection === "deposits") {
      await client.execute({
        sql: `INSERT INTO smm_deposits (id, user_id, amount, status, transaction_id, data)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                status = excluded.status,
                transaction_id = excluded.transaction_id,
                data = excluded.data;`,
        args: [
          id,
          data.userId || data.userEmail || "",
          Number(data.amount || 0),
          data.status || "pending",
          data.transactionId || data.utr || "",
          dataJson
        ]
      });
    } else if (collection === "providers") {
      await client.execute({
        sql: `INSERT INTO smm_providers (id, name, api_url, api_key, balance, status, data, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                api_url = excluded.api_url,
                api_key = excluded.api_key,
                balance = excluded.balance,
                status = excluded.status,
                data = excluded.data,
                updated_at = excluded.updated_at;`,
        args: [
          id,
          data.name || "",
          data.apiUrl || data.url || "",
          data.apiKey || data.key || "",
          Number(data.balance || 0),
          data.status || "active",
          dataJson,
          now
        ]
      });
    } else if (collection === "settings") {
      await client.execute({
        sql: `INSERT INTO smm_settings (key, value, updated_at)
              VALUES (?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at;`,
        args: [id, dataJson, now]
      });
    }
  } catch (err: any) {
    console.warn(`[TURSO] Error saving ${collection}/${id}:`, err?.message || err);
  }
}

// Delete document from Turso
export async function tursoDeleteDoc(collection: string, id: string): Promise<void> {
  const client = getTursoClient();
  if (!client || !collection || !id) return;

  try {
    await client.execute({
      sql: `DELETE FROM smm_documents WHERE collection = ? AND id = ?;`,
      args: [collection, id]
    });

    if (collection === "courses") {
      await client.execute({ sql: `DELETE FROM smm_courses WHERE id = ?;`, args: [id] });
    } else if (collection === "orders") {
      await client.execute({ sql: `DELETE FROM smm_orders WHERE id = ?;`, args: [id] });
    } else if (collection === "users") {
      await client.execute({ sql: `DELETE FROM smm_users WHERE id = ?;`, args: [id] });
    } else if (collection === "deposits") {
      await client.execute({ sql: `DELETE FROM smm_deposits WHERE id = ?;`, args: [id] });
    } else if (collection === "providers") {
      await client.execute({ sql: `DELETE FROM smm_providers WHERE id = ?;`, args: [id] });
    }
  } catch (err: any) {
    console.warn(`[TURSO] Error deleting ${collection}/${id}:`, err?.message || err);
  }
}

// Get document from Turso
export async function tursoGetDoc(collection: string, id: string): Promise<any | null> {
  const client = getTursoClient();
  if (!client) return null;

  try {
    if (collection === "users") {
      const res = await client.execute({
        sql: `SELECT id, email, role, balance, data FROM smm_users WHERE id = ? LIMIT 1;`,
        args: [id]
      });
      if (res.rows.length > 0) {
        const row = res.rows[0];
        let data: any = {};
        if (typeof row.data === "string") {
          try { data = JSON.parse(row.data); } catch (e) {}
        }
        return {
          ...data,
          id: row.id,
          uid: row.id,
          email: row.email || data.email || "",
          role: row.role || data.role || "student",
          balance: Number(row.balance !== undefined ? row.balance : data.balance || 0),
          updatedAt: row.updated_at || data.updatedAt
        };
      }
    }

    const res = await client.execute({
      sql: `SELECT data FROM smm_documents WHERE collection = ? AND id = ? LIMIT 1;`,
      args: [collection, id]
    });

    if (res.rows.length > 0 && res.rows[0].data) {
      return JSON.parse(String(res.rows[0].data));
    }
    return null;
  } catch (err) {
    return null;
  }
}

// List documents from Turso
export async function tursoListDocs(collection: string, limit: number = 200): Promise<any[]> {
  const client = getTursoClient();
  if (!client) return [];

  try {
    const res = await client.execute({
      sql: `SELECT data FROM smm_documents WHERE collection = ? ORDER BY updated_at DESC LIMIT ?;`,
      args: [collection, limit]
    });

    const docs = res.rows.map(r => {
      try {
        return JSON.parse(String(r.data));
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    if (collection === "users") {
      try {
        const uRes = await client.execute({
          sql: `SELECT id, email, role, balance, data FROM smm_users LIMIT ?;`,
          args: [limit]
        });
        const userMap = new Map();
        for (const row of uRes.rows) {
          userMap.set(String(row.id), row);
        }

        // For existing docs, overwrite with real column values
        docs.forEach(d => {
          const uid = d.id || d.uid;
          if (uid && userMap.has(uid)) {
            const row = userMap.get(uid);
            d.balance = Number(row.balance !== undefined ? row.balance : d.balance || 0);
            d.role = row.role || d.role || "student";
            d.email = row.email || d.email || "";
            d.userEmail = row.email || d.email || "";
          }
        });

        // Add any missing users
        for (const row of uRes.rows) {
          const uId = String(row.id || "");
          const exists = docs.some(d => (d.id || d.uid) === uId);
          if (uId && !exists) {
            let parsed: any = {};
            if (typeof row.data === "string") {
              try { parsed = JSON.parse(row.data); } catch (e) {}
            }
            docs.push({
              ...parsed,
              id: uId,
              uid: uId,
              email: row.email || parsed.email || "",
              userEmail: row.email || parsed.email || "",
              role: row.role || parsed.role || "student",
              balance: Number(row.balance !== undefined ? row.balance : parsed.balance || 0)
            });
          }
        }
      } catch (uErr) {}
    } else if (collection === "courses") {
      try {
        const cRes = await client.execute({
          sql: `SELECT id, title, category, price, provider_id, provider_service_id, min_limit, max_limit, status, data FROM smm_courses LIMIT ?;`,
          args: [limit]
        });
        const existingIds = new Set(docs.map((d: any) => d.id));
        for (const row of cRes.rows) {
          const cId = String(row.id || "");
          if (cId && !existingIds.has(cId)) {
            let parsed: any = {};
            if (typeof row.data === "string") {
              try { parsed = JSON.parse(row.data); } catch (e) {}
            }
            docs.push({
              ...parsed,
              id: cId,
              title: row.title || parsed.title,
              category: row.category || parsed.category || "General",
              price: Number(row.price ?? parsed.price ?? 0),
              pricePerThousand: Number(row.price ?? parsed.pricePerThousand ?? parsed.price ?? 0),
              providerId: row.provider_id || parsed.providerId,
              providerServiceId: row.provider_service_id || parsed.providerServiceId,
              minLimit: Number(row.min_limit ?? parsed.minLimit ?? 0),
              maxLimit: Number(row.max_limit ?? parsed.maxLimit ?? 0),
              status: row.status || parsed.status || "active"
            });
            existingIds.add(cId);
          }
        }
      } catch (cErr) {}
    } else if (collection === "providers") {
      try {
        const pRes = await client.execute({
          sql: `SELECT id, name, api_url, api_key, balance, status, data FROM smm_providers LIMIT ?;`,
          args: [limit]
        });
        const existingIds = new Set(docs.map((d: any) => d.id));
        for (const row of pRes.rows) {
          const pId = String(row.id || "");
          if (pId && !existingIds.has(pId)) {
            let parsed: any = {};
            if (typeof row.data === "string") {
              try { parsed = JSON.parse(row.data); } catch (e) {}
            }
            docs.push({
              ...parsed,
              id: pId,
              name: row.name || parsed.name,
              apiUrl: row.api_url || parsed.apiUrl,
              apiKey: row.api_key || parsed.apiKey,
              balance: Number(row.balance ?? parsed.balance ?? 0),
              status: row.status || parsed.status || "active"
            });
            existingIds.add(pId);
          }
        }
      } catch (pErr) {}
    }

    return docs;
  } catch (err) {
    return [];
  }
}

// Sync all local database items to Turso in bulk
export async function syncAllLocalDataToTurso(allData: Record<string, Record<string, any>>): Promise<{ success: boolean; syncedCount: number; message: string }> {
  const client = getTursoClient();
  if (!client) {
    return { success: false, syncedCount: 0, message: "Turso is not connected. Please configure URL and Token first." };
  }

  let totalSynced = 0;

  try {
    await initTursoTables(client);

    for (const [colName, colDocs] of Object.entries(allData || {})) {
      if (!colDocs || typeof colDocs !== "object") continue;

      for (const [docId, docData] of Object.entries(colDocs)) {
        if (!docData) continue;
        await tursoSetDoc(colName, docId, docData);
        totalSynced++;
      }
    }

    currentConfig.lastSync = new Date().toISOString();
    try {
      fs.writeFileSync(configFile, JSON.stringify(currentConfig, null, 2), "utf-8");
    } catch (e) {}

    return {
      success: true,
      syncedCount: totalSynced,
      message: `Successfully synced ${totalSynced} items to Turso database!`
    };
  } catch (err: any) {
    return {
      success: false,
      syncedCount: totalSynced,
      message: `Sync encountered an error: ${err?.message || err}`
    };
  }
}

// Aliases for compatibility
export const getTursoDoc = tursoGetDoc;
export const setTursoDoc = tursoSetDoc;
export const listTursoDocs = tursoListDocs;
export const deleteTursoDoc = tursoDeleteDoc;

// Load config initially
loadTursoConfigFromDisk();
