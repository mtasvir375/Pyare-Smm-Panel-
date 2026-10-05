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
