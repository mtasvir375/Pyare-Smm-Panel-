import axios from "axios";

const FIREBASE_PROJECT_ID = "gen-lang-client-0629912823";
const FIREBASE_DATABASE_ID = "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";
const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY || "AIzaSyBW_IUbuocn83oBCfQfbZsGbswo-OcgxRY";

function unwrapFirestoreFields(fields: any): any {
  if (!fields) return {};
  const res: any = {};
  for (const key of Object.keys(fields)) {
    const val = fields[key];
    if (val.stringValue !== undefined) res[key] = val.stringValue;
    else if (val.integerValue !== undefined) res[key] = parseInt(val.integerValue, 10);
    else if (val.doubleValue !== undefined) res[key] = parseFloat(val.doubleValue);
    else if (val.booleanValue !== undefined) res[key] = val.booleanValue;
    else if (val.timestampValue !== undefined) res[key] = val.timestampValue;
    else if (val.mapValue && val.mapValue.fields) res[key] = unwrapFirestoreFields(val.mapValue.fields);
    else res[key] = null;
  }
  return res;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const firestoreBase = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents`;

    const [logsRes, poolRes, pendingRes] = await Promise.allSettled([
      axios.get(`${firestoreBase}/sms_forwarder_logs?pageSize=100&key=${FIREBASE_API_KEY}`, { timeout: 5000 }),
      axios.get(`${firestoreBase}/sms_forwarder_pool?pageSize=100&key=${FIREBASE_API_KEY}`, { timeout: 5000 }),
      axios.get(`${firestoreBase}/pending_user_utrs?pageSize=100&key=${FIREBASE_API_KEY}`, { timeout: 5000 })
    ]);

    const logs: any[] = [];
    if (logsRes.status === "fulfilled" && logsRes.value.data.documents) {
      logsRes.value.data.documents.forEach((d: any) => {
        const id = d.name.split("/").pop();
        logs.push({ id, ...unwrapFirestoreFields(d.fields) });
      });
      logs.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
    }

    const available: any[] = [];
    if (poolRes.status === "fulfilled" && poolRes.value.data.documents) {
      poolRes.value.data.documents.forEach((d: any) => {
        const item = unwrapFirestoreFields(d.fields);
        if (item.status === "available") {
          available.push(item);
        }
      });
    }

    const pendingUsers: any[] = [];
    if (pendingRes.status === "fulfilled" && pendingRes.value.data.documents) {
      pendingRes.value.data.documents.forEach((d: any) => {
        pendingUsers.push(unwrapFirestoreFields(d.fields));
      });
    }

    return res.status(200).json({
      success: true,
      logs,
      available,
      pendingUsers
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
