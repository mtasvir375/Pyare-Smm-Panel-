import axios from "axios";

const FIREBASE_PROJECT_ID = "gen-lang-client-0629912823";
const FIREBASE_DATABASE_ID = "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";
const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY || "AIzaSyBW_IUbuocn83oBCfQfbZsGbswo-OcgxRY";

function unwrapDoc(doc: any): any {
  if (!doc) return null;
  const id = doc.name ? doc.name.split("/").pop() : "";
  const fields = doc.fields || {};
  const res: any = { id };
  for (const k of Object.keys(fields)) {
    const f = fields[k];
    if (f.stringValue !== undefined) res[k] = f.stringValue;
    else if (f.integerValue !== undefined) res[k] = Number(f.integerValue);
    else if (f.doubleValue !== undefined) res[k] = Number(f.doubleValue);
    else if (f.booleanValue !== undefined) res[k] = f.booleanValue;
    else if (f.timestampValue !== undefined) res[k] = f.timestampValue;
  }
  return res;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader("Access-Control-Allow-Headers", "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

  try {
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: "orderId required" });

    const authHeader = req.headers.authorization;
    const headers: any = { "Content-Type": "application/json" };
    if (authHeader) headers["Authorization"] = authHeader;

    const orderUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/orders/${orderId}?key=${FIREBASE_API_KEY}`;
    const oRes = await axios.get(orderUrl, { headers, timeout: 5000 });
    if (!oRes.data || !oRes.data.fields) return res.status(404).json({ error: "Order not found" });

    const order = unwrapDoc(oRes.data);
    const currentStatus = order.status || "Pending";
    const terminalStatuses = ["Completed", "Canceled", "Refunded", "Partial", "Failed"];
    if (terminalStatuses.includes(currentStatus)) {
      return res.json({ success: true, status: currentStatus, upToDate: true });
    }

    return res.json({ success: true, status: currentStatus });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to sync order" });
  }
}
