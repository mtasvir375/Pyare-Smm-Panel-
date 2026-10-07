import { createClient, Client } from "@libsql/client/web";

export const TURSO_DATABASE_URL = "libsql://pyare-smm-panel-pyaresmmpanel.aws-ap-south-1.turso.io";
export const TURSO_AUTH_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTEwNjQ0NzgsImlkIjoiMDFhMTAzYzEtNzYwMS03NDk5LTljYWMtYzdkMDExOWU5M2ZkIiwia2lkIjoiYVFCV3BPanpQSVA2czQzcGlrZ29pbkJtVlNodDZOTmh0YndUejBpaDRGOCIsInJpZCI6IjM0MTg2ZDIxLTgwYTUtNDU1YS1hOWQ3LWJhNGQzZTJlNTIzYSJ9.MXelOKfVsMZZoYfKiflhegiqqXQD5-0HN_faUU4z7WtQdjiQQTWXpU-i8jF1DiQrRpFUUV5wol-7dikl8pW5Dw";

let clientInstance: Client | null = null;

export function getTursoWebClient(): Client | null {
  if (clientInstance) return clientInstance;
  try {
    clientInstance = createClient({
      url: TURSO_DATABASE_URL,
      authToken: TURSO_AUTH_TOKEN
    });
    return clientInstance;
  } catch (err: any) {
    console.warn("[TURSO-WEB] Client init failed:", err?.message || err);
    return null;
  }
}

/**
 * Direct write to Turso Cloud Database from frontend (Custom domain, Vercel, Localhost, etc.)
 */
export async function clientTursoSetDoc(collection: string, id: string, data: any): Promise<boolean> {
  const client = getTursoWebClient();
  if (!client || !collection || !id) return false;

  const dataJson = JSON.stringify(data);
  const now = new Date().toISOString();

  try {
    // 1. Always write to master smm_documents table
    await client.execute({
      sql: `INSERT INTO smm_documents (collection, id, data, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at;`,
      args: [collection, id, dataJson, now]
    });

    // 2. Write to dedicated collection table if applicable
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
          Number(data.pricePerThousand !== undefined ? data.pricePerThousand : data.price !== undefined ? data.price : 0),
          String(data.providerId ?? data.provider_id ?? "").trim(),
          String(data.providerServiceId ?? data.provider_service_id ?? "").trim(),
          Number(data.minLimit !== undefined ? data.minLimit : data.min_limit !== undefined ? data.min_limit : 1),
          Number(data.maxLimit !== undefined ? data.maxLimit : data.max_limit !== undefined ? data.max_limit : 100000),
          data.status || "published",
          dataJson,
          now
        ]
      });
      console.log(`[TURSO-WEB] Successfully saved course "${data.title || id}" directly to Turso smm_courses!`);
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
          data.role || "student",
          Number(data.balance || 0),
          dataJson,
          now
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
          data.name || id,
          data.apiUrl || data.api_url || "",
          data.apiKey || data.api_key || "",
          Number(data.balance || 0),
          data.status || "active",
          dataJson,
          now
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
    }

    return true;
  } catch (err: any) {
    console.warn(`[TURSO-WEB-SET-WARN] ${collection}/${id}:`, err?.message || err);
    return false;
  }
}

/**
 * Direct delete from Turso Cloud Database from frontend
 */
export async function clientTursoDeleteDoc(collection: string, id: string): Promise<boolean> {
  const client = getTursoWebClient();
  if (!client || !collection || !id) return false;

  try {
    await client.execute({
      sql: `DELETE FROM smm_documents WHERE collection = ? AND id = ?;`,
      args: [collection, id]
    });

    if (collection === "courses") {
      await client.execute({ sql: `DELETE FROM smm_courses WHERE id = ?;`, args: [id] });
    } else if (collection === "users") {
      await client.execute({ sql: `DELETE FROM smm_users WHERE id = ?;`, args: [id] });
    } else if (collection === "providers") {
      await client.execute({ sql: `DELETE FROM smm_providers WHERE id = ?;`, args: [id] });
    }
    return true;
  } catch (err: any) {
    console.warn(`[TURSO-WEB-DEL-WARN] ${collection}/${id}:`, err?.message || err);
    return false;
  }
}

/**
 * Direct fetch from Turso Cloud Database from frontend
 */
export async function clientTursoGetDoc(collection: string, id: string): Promise<any | null> {
  const client = getTursoWebClient();
  if (!client || !collection || !id) return null;

  try {
    const res = await client.execute({
      sql: `SELECT data FROM smm_documents WHERE collection = ? AND id = ? LIMIT 1;`,
      args: [collection, id]
    });

    if (res.rows.length === 0) return null;
    const raw = res.rows[0]?.data;
    if (typeof raw === "string") {
      try { return JSON.parse(raw); } catch (e) {}
    }
    return raw || null;
  } catch (err: any) {
    return null;
  }
}

/**
 * Direct update to Turso Cloud Database with existing data merging
 */
export async function clientTursoUpdateDoc(collection: string, id: string, data: any): Promise<boolean> {
  const client = getTursoWebClient();
  if (!client || !collection || !id) return false;

  try {
    const existing = (await clientTursoGetDoc(collection, id)) || {};
    const merged = { ...existing, ...data, id, updatedAt: new Date().toISOString() };
    return await clientTursoSetDoc(collection, id, merged);
  } catch (err: any) {
    console.warn(`[TURSO-UPDATE-WARN] ${collection}/${id}:`, err?.message || err);
    return false;
  }
}

/**
 * Direct list query from Turso Cloud Database from frontend (Browser)
 */
export async function clientTursoGetDocs(collection: string, limitCount = 100): Promise<any[]> {
  const client = getTursoWebClient();
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

    // Direct specialized table overrides for front-end accuracy
    if (collection === "users") {
      try {
        const uRes = await client.execute({
          sql: `SELECT id, email, role, balance, data FROM smm_users LIMIT ?;`,
          args: [limitCount]
        });
        const userMap = new Map();
        for (const row of uRes.rows) {
          userMap.set(String(row.id), row);
        }
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
      } catch (e) {}
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
      } catch (e) {}
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
      } catch (e) {}
    }

    return docs;
  } catch (err: any) {
    return [];
  }
}
