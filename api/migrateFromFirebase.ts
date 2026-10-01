import axios from "axios";
import fs from "fs";
import path from "path";
import { getLocalSqliteDb, setLocalDoc, getLocalDoc } from "./localDb";

const collectionsToMigrate = [
  "users",
  "orders",
  "deposits",
  "settings",
  "courses",
  "providers",
  "bank_alerts",
  "claimed_payments",
  "payment_intents",
  "sms_forwarder_pool"
];

function unwrapFirestoreFields(fields: any): any {
  if (!fields) return {};
  const res: any = {};
  for (const key of Object.keys(fields)) {
    const val = fields[key];
    if (val === undefined || val === null) continue;
    if (val.stringValue !== undefined) res[key] = val.stringValue;
    else if (val.integerValue !== undefined) res[key] = parseInt(val.integerValue, 10);
    else if (val.doubleValue !== undefined) res[key] = parseFloat(val.doubleValue);
    else if (val.booleanValue !== undefined) res[key] = val.booleanValue;
    else if (val.timestampValue !== undefined) res[key] = val.timestampValue;
    else if (val.arrayValue && val.arrayValue.values) {
      res[key] = val.arrayValue.values.map((v: any) => {
        if (v.stringValue !== undefined) return v.stringValue;
        if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
        if (v.doubleValue !== undefined) return parseFloat(v.doubleValue);
        if (v.booleanValue !== undefined) return v.booleanValue;
        if (v.mapValue) return unwrapFirestoreFields(v.mapValue.fields);
        return v;
      });
    } else if (val.mapValue && val.mapValue.fields) {
      res[key] = unwrapFirestoreFields(val.mapValue.fields);
    } else {
      res[key] = null;
    }
  }
  return res;
}

export async function migrateAllFromFirebase(): Promise<{ success: boolean; migrated: Record<string, number>; errors: string[] }> {
  await getLocalSqliteDb();
  const summary: Record<string, number> = {};
  const errors: string[] = [];

  let cfg: any = {};
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
  } catch (e) {}

  const projectId = cfg.projectId || "gen-lang-client-0629912823";
  const databaseId = cfg.firestoreDatabaseId || "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";
  const apiKey = cfg.apiKey || "AIzaSyBW_IUbuocn83oBCfQfbZsGbswo-OcgxRY";

  for (const col of collectionsToMigrate) {
    try {
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents:runQuery?key=${apiKey}`;
      const payload = {
        structuredQuery: {
          from: [{ collectionId: col }],
          limit: 1000
        }
      };
      const res = await axios.post(url, payload, { timeout: 10000 });
      let count = 0;
      if (res.data && Array.isArray(res.data)) {
        for (const item of res.data) {
          if (!item.document) continue;
          const doc = item.document;
          const id = doc.name.split("/").pop();
          if (!id) continue;
          const data = unwrapFirestoreFields(doc.fields || {});
          
          // Preserve local state if local balance/updatedAt is newer
          const existing = getLocalDoc(col, id);
          if (!existing) {
            setLocalDoc(col, id, { id, ...data });
            count++;
          } else {
            setLocalDoc(col, id, { ...data, ...existing, id });
            count++;
          }
        }
      }
      summary[col] = count;
      console.log(`[MIGRATION] Collection "${col}" migrated ${count} documents to SQLite.`);
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.message;
      errors.push(`Collection "${col}": ${msg}`);
      console.warn(`[MIGRATION-WARN] Could not fetch "${col}" from Firebase (${msg}). Preserving existing local SQLite data.`);
    }
  }

  return { success: errors.length === 0, migrated: summary, errors };
}
