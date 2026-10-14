import axios from "axios";
import { formatApiUrl } from "./apiConfig";

/**
 * Secure Backend-Proxied Database Client for Frontend.
 * NOTE: Direct database credentials (URLs / Tokens) are strictly NEVER bundled into client-side code!
 * All database reads and writes are safely proxied through verified server endpoints (/api/db/*),
 * guaranteeing strict server-side authentication, role enforcement, and balance protection.
 */

export async function clientTursoGetDoc(collection: string, id: string): Promise<any | null> {
  if (!collection || !id) return null;
  try {
    const res = await axios.post(formatApiUrl('/api/db/get'), { collection, id, fresh: true }, { timeout: 8000 });
    if (res.data && res.data.success && res.data.data) {
      return { id, ...res.data.data };
    }
  } catch (err: any) {
    // Graceful fallback
  }
  return null;
}

export async function clientTursoGetDocs(collection: string, limitCount = 100): Promise<any[]> {
  if (!collection) return [];
  try {
    const res = await axios.post(formatApiUrl('/api/db/list'), { collection, limit: limitCount, fresh: true }, { timeout: 8000 });
    if (res.data && res.data.success && Array.isArray(res.data.data)) {
      return res.data.data;
    }
  } catch (err: any) {
    // Graceful fallback
  }
  return [];
}

export async function clientTursoSetDoc(collection: string, id: string, data: any): Promise<boolean> {
  if (!collection || !id) return false;
  // Security Guard: Prevent any direct writes to sensitive collections from browser
  if (["users", "deposits", "settings", "providers", "bank_alerts", "transactions", "api_keys"].includes(collection)) {
    console.warn(`[SECURITY] Direct writes to "${collection}" are forbidden from browser.`);
    return false;
  }
  try {
    const res = await axios.post(formatApiUrl('/api/db/set'), { collection, id, data }, { timeout: 8000 });
    return !!res.data?.success;
  } catch (err: any) {
    return false;
  }
}

export async function clientTursoUpdateDoc(collection: string, id: string, data: any): Promise<boolean> {
  if (!collection || !id) return false;
  if (["users", "deposits", "settings", "providers", "bank_alerts", "transactions", "api_keys"].includes(collection)) {
    console.warn(`[SECURITY] Direct updates to "${collection}" are forbidden from browser.`);
    return false;
  }
  try {
    const res = await axios.post(formatApiUrl('/api/db/update'), { collection, id, data }, { timeout: 8000 });
    return !!res.data?.success;
  } catch (err: any) {
    return false;
  }
}

export async function clientTursoDeleteDoc(collection: string, id: string): Promise<boolean> {
  if (!collection || !id) return false;
  if (["users", "deposits", "settings", "providers", "bank_alerts", "transactions", "api_keys"].includes(collection)) {
    console.warn(`[SECURITY] Direct deletion of "${collection}" is forbidden from browser.`);
    return false;
  }
  try {
    const res = await axios.post(formatApiUrl('/api/db/delete'), { collection, id }, { timeout: 8000 });
    return !!res.data?.success;
  } catch (err: any) {
    return false;
  }
}

export function getTursoWebClient(): any {
  // Direct client removed for security - all DB operations are safely proxied via verified backend
  return null;
}
