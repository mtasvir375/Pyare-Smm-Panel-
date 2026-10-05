import { createClient, Client } from "@libsql/client";

export const DEFAULT_TURSO_URL = "libsql://pyare-smm-panel-pyaresmmpanel.aws-ap-south-1.turso.io";
export const DEFAULT_TURSO_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTEwNjQ0NzgsImlkIjoiMDFhMTAzYzEtNzYwMS03NDk5LTljYWMtYzdkMDExOWU5M2ZkIiwia2lkIjoiYVFCV3BPanpQSVA2czQzcGlrZ29pbkJtVlNodDZOTmh0YndUejBpaDRGOCIsInJpZCI6IjM0MTg2ZDIxLTgwYTUtNDU1YS1hOWQ3LWJhNGQzZTJlNTIzYSJ9.MXelOKfVsMZZoYfKiflhegiqqXQD5-0HN_faUU4z7WtQdjiQQTWXpU-i8jF1DiQrRpFUUV5wol-7dikl8pW5Dw";

let tursoClient: Client | null = null;
let currentConfig = {
  url: process.env.TURSO_DATABASE_URL || process.env.TURSO_URL || DEFAULT_TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN || process.env.TURSO_TOKEN || DEFAULT_TURSO_TOKEN,
  autoSync: true
};

export function initTursoClient(url?: string, authToken?: string): Client | null {
  const cleanUrl = (url || currentConfig.url || DEFAULT_TURSO_URL).trim();
  const cleanToken = (authToken || currentConfig.authToken || DEFAULT_TURSO_TOKEN).trim();

  if (!cleanUrl || !cleanToken) {
    tursoClient = null;
    return null;
  }

  try {
    tursoClient = createClient({
      url: cleanUrl,
      authToken: cleanToken
    });
    initTursoSchema(tursoClient).catch(() => {});
    return tursoClient;
  } catch (err: any) {
    console.error("[TURSO] Error initializing libSQL client:", err?.message || err);
    tursoClient = null;
    return null;
  }
}

export function getTursoClient(): Client | null {
  if (!tursoClient) {
    initTursoClient();
  }
  return tursoClient;
}

export async function initTursoSchema(client?: Client): Promise<boolean> {
  const cli = client || getTursoClient();
  if (!cli) return false;

  try {
    await cli.execute(`
      CREATE TABLE IF NOT EXISTS smm_documents (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (collection, id)
      );
    `);

    await cli.execute(`
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

    await cli.execute(`
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

    await cli.execute(`
      CREATE TABLE IF NOT EXISTS smm_users (
        id TEXT PRIMARY KEY,
        email TEXT,
        role TEXT,
        balance REAL,
        data TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await cli.execute(`
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

    await cli.execute(`
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

    await cli.execute(`
      CREATE TABLE IF NOT EXISTS smm_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    return true;
  } catch (err: any) {
    console.error("[TURSO-INIT-ERR]", err.message);
    return false;
  }
}

export async function getTursoDoc(collection: string, id: string): Promise<any | null> {
  const client = getTursoClient();
  if (!client || !collection || !id) return null;

  try {
    const res = await client.execute({
      sql: `SELECT data FROM smm_documents WHERE collection = ? AND id = ? LIMIT 1;`,
      args: [collection, id]
    });

    if (res.rows.length === 0) return null;
    const raw = res.rows[0]?.data;
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch (e) {}
    }
    return raw || null;
  } catch (err: any) {
    console.warn(`[TURSO-GET-ERR] ${collection}/${id}:`, err.message);
    return null;
  }
}

export async function setTursoDoc(collection: string, id: string, data: any): Promise<boolean> {
  const client = getTursoClient();
  if (!client || !collection || !id) return false;

  const dataJson = JSON.stringify(data);
  const now = new Date().toISOString();

  try {
    await client.execute({
      sql: `INSERT INTO smm_documents (collection, id, data, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at;`,
      args: [collection, id, dataJson, now]
    });

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
    } else if (collection === "deposits") {
      await client.execute({
        sql: `INSERT INTO smm_deposits (id, user_id, amount, status, transaction_id, data, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                status = excluded.status,
                data = excluded.data;`,
        args: [
          id,
          data.userId || data.user_id || "",
          Number(data.amount || 0),
          data.status || "pending",
          data.utr || data.transaction_id || id,
          dataJson,
          data.createdAt || now
        ]
      });

      if ((data.status === "approved" || data.status === "completed") && (data.userId || data.user_id)) {
        const uId = data.userId || data.user_id;
        const depAmt = Number(data.amount || 0);
        if (depAmt > 0) {
          try {
            await client.execute({
              sql: `UPDATE smm_users SET balance = balance + ?, updated_at = ? WHERE id = ?;`,
              args: [depAmt, now, uId]
            });
          } catch (e) {}
        }
      }
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
    } else if (collection === "settings") {
      await client.execute({
        sql: `INSERT INTO smm_settings (key, value, updated_at)
              VALUES (?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`,
        args: [id, dataJson, now]
      });
    }

    return true;
  } catch (err: any) {
    console.error(`[TURSO-SET-ERR] ${collection}/${id}:`, err.message);
    return false;
  }
}

export async function listTursoDocs(collection: string, limitCount = 200): Promise<any[]> {
  const client = getTursoClient();
  if (!client || !collection) return [];

  try {
    const res = await client.execute({
      sql: `SELECT data FROM smm_documents WHERE collection = ? ORDER BY updated_at DESC LIMIT ?;`,
      args: [collection, limitCount]
    });

    const docs: any[] = [];
    for (const row of res.rows) {
      const raw = row.data;
      if (typeof raw === "string") {
        try {
          docs.push(JSON.parse(raw));
        } catch (e) {}
      } else if (raw && typeof raw === "object") {
        docs.push(raw);
      }
    }

    // Secondary merge for users, courses, providers so data in specialized tables is never lost
    if (collection === "users") {
      try {
        const uRes = await client.execute({
          sql: `SELECT id, email, role, balance, data FROM smm_users LIMIT ?;`,
          args: [limitCount]
        });
        const existingIds = new Set(docs.map(d => d.id || d.uid));
        for (const row of uRes.rows) {
          const uId = String(row.id || "");
          if (uId && !existingIds.has(uId)) {
            let parsed: any = {};
            if (typeof row.data === "string") {
              try { parsed = JSON.parse(row.data); } catch (e) {}
            }
            docs.push({
              ...parsed,
              id: uId,
              uid: uId,
              email: row.email || parsed.email,
              userEmail: row.email || parsed.email,
              role: row.role || parsed.role || "user",
              balance: Number(row.balance ?? parsed.balance ?? 0)
            });
            existingIds.add(uId);
          }
        }
      } catch (uErr) {}
    } else if (collection === "courses") {
      try {
        const cRes = await client.execute({
          sql: `SELECT id, title, category, price, provider_id, provider_service_id, min_limit, max_limit, status, data FROM smm_courses LIMIT ?;`,
          args: [limitCount]
        });
        const existingIds = new Set(docs.map(d => d.id));
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
          args: [limitCount]
        });
        const existingIds = new Set(docs.map(d => d.id));
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
  } catch (err: any) {
    console.warn(`[TURSO-LIST-ERR] ${collection}:`, err.message);
    return [];
  }
}

export async function deleteTursoDoc(collection: string, id: string): Promise<boolean> {
  const client = getTursoClient();
  if (!client || !collection || !id) return false;

  try {
    await client.execute({
      sql: `DELETE FROM smm_documents WHERE collection = ? AND id = ?;`,
      args: [collection, id]
    });
    if (collection === "courses") {
      await client.execute({ sql: `DELETE FROM smm_courses WHERE id = ?;`, args: [id] });
    }
    return true;
  } catch (err: any) {
    console.error(`[TURSO-DEL-ERR] ${collection}/${id}:`, err.message);
    return false;
  }
}

export async function updateTursoCredentials(url: string, authToken: string): Promise<{ success: boolean; message: string }> {
  currentConfig.url = url;
  currentConfig.authToken = authToken;
  initTursoClient(url, authToken);
  return { success: true, message: "Credentials updated" };
}
