import { createClient, Client } from "@libsql/client";
import path from "path";
import fs from "fs";

let tursoClient: Client | null = null;
let isInitialized = false;

export function getTursoClient(): Client {
  if (tursoClient) return tursoClient;

  const DEFAULT_TURSO_URL = "libsql://pyare-smm-panel-pyaresmmpanel.aws-ap-south-1.turso.io";
  const DEFAULT_TURSO_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTEwNjQ0NzgsImlkIjoiMDFhMTAzYzEtNzYwMS03NDk5LTljYWMtYzdkMDExOWU5M2ZkIiwia2lkIjoiYVFCV3BPanpQSVA2czQzcGlrZ29pbkJtVlNodDZOTmh0YndUejBpaDRGOCIsInJpZCI6IjM0MTg2ZDIxLTgwYTUtNDU1YS1hOWQ3LWJhNGQzZTJlNTIzYSJ9.MXelOKfVsMZZoYfKiflhegiqqXQD5-0HN_faUU4z7WtQdjiQQTWXpU-i8jF1DiQrRpFUUV5wol-7dikl8pW5Dw";

  const url = process.env.TURSO_DATABASE_URL || process.env.VITE_TURSO_DATABASE_URL || DEFAULT_TURSO_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN || process.env.VITE_TURSO_AUTH_TOKEN || DEFAULT_TURSO_TOKEN;

  if (url && url.startsWith("libsql://")) {
    tursoClient = createClient({
      url: url.trim(),
      authToken: authToken.trim()
    });
    console.log(`[TURSO] Initialized Remote Turso Cloud Client: ${url}`);
  } else {
    // Embedded local SQLite fallback using LibSQL file protocol
    const dbDir = path.join(process.cwd(), "data");
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const localDbPath = path.join(dbDir, "turso_store.db");
    tursoClient = createClient({
      url: `file:${localDbPath}`
    });
    console.log(`[TURSO] Initialized Local Embedded LibSQL Database: ${localDbPath}`);
  }

  return tursoClient;
}

export function updateTursoCredentials(url: string, authToken: string): Client {
  if (url && url.startsWith("libsql://")) {
    tursoClient = createClient({
      url: url.trim(),
      authToken: authToken.trim()
    });
    console.log(`[TURSO] Re-initialized Turso Client with new credentials: ${url}`);
  }
  return getTursoClient();
}

export async function initTursoSchema(): Promise<boolean> {
  if (isInitialized) return true;
  const client = getTursoClient();

  try {
    // 1. Users Table
    await client.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT,
        userEmail TEXT,
        displayName TEXT,
        role TEXT DEFAULT 'student',
        balance REAL DEFAULT 0,
        data TEXT,
        createdAt TEXT,
        updatedAt TEXT
      );
    `);

    // 2. Orders Table
    await client.execute(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        userId TEXT,
        userEmail TEXT,
        serviceId TEXT,
        title TEXT,
        targetLink TEXT,
        quantity INTEGER,
        totalPrice REAL,
        status TEXT DEFAULT 'Pending',
        providerOrderId TEXT,
        data TEXT,
        createdAt TEXT,
        updatedAt TEXT
      );
    `);

    // 3. Deposits Table
    await client.execute(`
      CREATE TABLE IF NOT EXISTS deposits (
        id TEXT PRIMARY KEY,
        userId TEXT,
        userEmail TEXT,
        amount REAL,
        utr TEXT,
        status TEXT DEFAULT 'pending',
        data TEXT,
        createdAt TEXT,
        updatedAt TEXT
      );
    `);

    // 4. Courses / Services Table
    await client.execute(`
      CREATE TABLE IF NOT EXISTS courses (
        id TEXT PRIMARY KEY,
        title TEXT,
        category TEXT,
        pricePerThousand REAL,
        minLimit INTEGER DEFAULT 1000,
        providerId TEXT,
        providerServiceId TEXT,
        status TEXT DEFAULT 'active',
        data TEXT,
        createdAt TEXT,
        updatedAt TEXT
      );
    `);

    // 5. Providers Table
    await client.execute(`
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        name TEXT,
        apiUrl TEXT,
        apiKey TEXT,
        data TEXT,
        createdAt TEXT,
        updatedAt TEXT
      );
    `);

    // 6. Settings Table
    await client.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY,
        data TEXT,
        updatedAt TEXT
      );
    `);

    isInitialized = true;
    console.log("[TURSO] All SQL tables verified and initialized successfully.");
    return true;
  } catch (err: any) {
    console.error("[TURSO-INIT-ERR] Failed to initialize Turso schema:", err.message);
    return false;
  }
}

// Helper: Get Single Document
export async function getTursoDoc(collection: string, id: string): Promise<any | null> {
  await initTursoSchema();
  const client = getTursoClient();

  try {
    const res = await client.execute({
      sql: `SELECT * FROM ${collection} WHERE id = ? LIMIT 1`,
      args: [id]
    });

    if (res.rows.length === 0) return null;
    const row = res.rows[0] as any;
    if (row.data) {
      try {
        const parsed = JSON.parse(row.data);
        return { ...parsed, id: row.id };
      } catch (e) {}
    }
    return row;
  } catch (err: any) {
    console.warn(`[TURSO-GET-ERR] ${collection}/${id}:`, err.message);
    return null;
  }
}

// Helper: Set / Upsert Document
export async function setTursoDoc(collection: string, id: string, data: any): Promise<boolean> {
  await initTursoSchema();
  const client = getTursoClient();

  try {
    const now = new Date().toISOString();
    const merged = { ...data, id, updatedAt: now, createdAt: data.createdAt || now };
    const serializedData = JSON.stringify(merged);

    if (collection === "users") {
      await client.execute({
        sql: `INSERT INTO users (id, email, userEmail, displayName, role, balance, data, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                email = excluded.email,
                userEmail = excluded.userEmail,
                displayName = excluded.displayName,
                role = excluded.role,
                balance = excluded.balance,
                data = excluded.data,
                updatedAt = excluded.updatedAt;`,
        args: [
          id,
          merged.email || "",
          merged.userEmail || merged.email || "",
          merged.displayName || "",
          merged.role || "student",
          Number(merged.balance || 0),
          serializedData,
          merged.createdAt,
          now
        ]
      });
    } else if (collection === "orders") {
      await client.execute({
        sql: `INSERT INTO orders (id, userId, userEmail, serviceId, title, targetLink, quantity, totalPrice, status, providerOrderId, data, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                status = excluded.status,
                providerOrderId = excluded.providerOrderId,
                data = excluded.data,
                updatedAt = excluded.updatedAt;`,
        args: [
          id,
          merged.userId || "",
          merged.userEmail || "",
          merged.serviceId || merged.courseId || "",
          merged.title || "",
          merged.targetLink || "",
          Number(merged.quantity || 0),
          Number(merged.totalPrice || 0),
          merged.status || "Pending",
          merged.providerOrderId || "",
          serializedData,
          merged.createdAt,
          now
        ]
      });
    } else if (collection === "courses") {
      await client.execute({
        sql: `INSERT INTO courses (id, title, category, pricePerThousand, minLimit, providerId, providerServiceId, status, data, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                category = excluded.category,
                pricePerThousand = excluded.pricePerThousand,
                minLimit = excluded.minLimit,
                providerId = excluded.providerId,
                providerServiceId = excluded.providerServiceId,
                status = excluded.status,
                data = excluded.data,
                updatedAt = excluded.updatedAt;`,
        args: [
          id,
          merged.title || "",
          merged.category || "Other",
          Number(merged.pricePerThousand || merged.price || 0),
          Number(merged.minLimit || 1000),
          merged.providerId || "",
          merged.providerServiceId || "",
          merged.status || "active",
          serializedData,
          merged.createdAt,
          now
        ]
      });
    } else if (collection === "providers") {
      await client.execute({
        sql: `INSERT INTO providers (id, name, apiUrl, apiKey, data, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                apiUrl = excluded.apiUrl,
                apiKey = excluded.apiKey,
                data = excluded.data,
                updatedAt = excluded.updatedAt;`,
        args: [
          id,
          merged.name || "",
          merged.apiUrl || merged.api_url || "",
          merged.apiKey || merged.api_key || "",
          serializedData,
          merged.createdAt,
          now
        ]
      });
    } else if (collection === "deposits") {
      await client.execute({
        sql: `INSERT INTO deposits (id, userId, userEmail, amount, utr, status, data, createdAt, updatedAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                status = excluded.status,
                data = excluded.data,
                updatedAt = excluded.updatedAt;`,
        args: [
          id,
          merged.userId || "",
          merged.userEmail || "",
          Number(merged.amount || 0),
          merged.utr || "",
          merged.status || "pending",
          serializedData,
          merged.createdAt,
          now
        ]
      });
    } else if (collection === "settings") {
      await client.execute({
        sql: `INSERT INTO settings (id, data, updatedAt)
              VALUES (?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                data = excluded.data,
                updatedAt = excluded.updatedAt;`,
        args: [id, serializedData, now]
      });
    }
    return true;
  } catch (err: any) {
    console.error(`[TURSO-SET-ERR] ${collection}/${id}:`, err.message);
    return false;
  }
}

// Helper: List Documents
export async function listTursoDocs(collection: string, limitCount = 100): Promise<any[]> {
  await initTursoSchema();
  const client = getTursoClient();

  try {
    const res = await client.execute({
      sql: `SELECT * FROM ${collection} ORDER BY updatedAt DESC LIMIT ?`,
      args: [limitCount]
    });

    return res.rows.map((row: any) => {
      if (row.data) {
        try {
          const parsed = JSON.parse(row.data);
          return { ...parsed, id: row.id };
        } catch (e) {}
      }
      return row;
    });
  } catch (err: any) {
    console.warn(`[TURSO-LIST-ERR] ${collection}:`, err.message);
    return [];
  }
}

// Helper: Delete Document
export async function deleteTursoDoc(collection: string, id: string): Promise<boolean> {
  await initTursoSchema();
  const client = getTursoClient();

  try {
    await client.execute({
      sql: `DELETE FROM ${collection} WHERE id = ?`,
      args: [id]
    });
    return true;
  } catch (err: any) {
    console.error(`[TURSO-DELETE-ERR] ${collection}/${id}:`, err.message);
    return false;
  }
}
