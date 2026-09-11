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
    const { userId, amount, userEmail } = req.body || {};
    if (!userId || !amount) return res.status(400).json({ error: "Missing fields" });

    const authHeader = req.headers.authorization;
    const headers: any = { "Content-Type": "application/json" };
    if (authHeader) headers["Authorization"] = authHeader;

    const settingsUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/settings/payment?key=${FIREBASE_API_KEY}`;
    let settings: any = {};
    try {
      const sRes = await axios.get(settingsUrl, { headers, timeout: 5000 });
      if (sRes.data && sRes.data.fields) {
        settings = unwrapDoc(sRes.data);
      }
    } catch (e) {}

    if (!settings.qrAutoEnabled) {
      return res.status(400).json({ error: "Auto QR is disabled." });
    }

    const { qrAutoProvider, qrAutoApiKey } = settings;

    if (qrAutoProvider === "upigateway") {
      const createUrl = "https://api.upigateway.com/api/v1/create_order";
      const client_txn_id = `DEP_${Date.now()}_${userId}`.slice(0, 30);

      try {
        const apiRes = await axios.post(createUrl, {
          key: qrAutoApiKey,
          client_txn_id: client_txn_id,
          amount: amount,
          p_info: "Wallet Deposit",
          customer_name: userEmail?.split("@")[0] || "User",
          customer_email: userEmail || "user@example.com",
          customer_mobile: "9999999999",
          redirect_url: `${req.headers.origin || "https://pyaresmmpanel.online"}/profile`
        }, { timeout: 15000 });

        if (apiRes.data.status === true || apiRes.data.msg?.toLowerCase().includes("success")) {
          return res.json({
            success: true,
            order_id: apiRes.data.data?.order_id,
            client_txn_id: client_txn_id,
            payment_url: apiRes.data.data?.payment_url
          });
        } else {
          return res.status(400).json({ error: apiRes.data.msg || "Failed to create order on UPIGateway." });
        }
      } catch (apiErr: any) {
        return res.status(500).json({ error: "Gateway connection failed." });
      }
    }

    return res.status(400).json({ error: "Gateway doesn't require pre-order generation." });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}
