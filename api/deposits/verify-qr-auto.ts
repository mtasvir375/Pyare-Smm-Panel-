import axios from "axios";

const FIREBASE_PROJECT_ID = "gen-lang-client-0629912823";
const FIREBASE_DATABASE_ID = "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";
const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY || "AIzaSyBW_IUbuocn83oBCfQfbZsGbswo-OcgxRY";

function wrapFirestoreFields(data: any): any {
  const fields: any = {};
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (val === undefined || val === null) continue;
    if (typeof val === "string") fields[key] = { stringValue: val };
    else if (typeof val === "number") {
      if (Number.isInteger(val)) fields[key] = { integerValue: val.toString() };
      else fields[key] = { doubleValue: val };
    } else if (typeof val === "boolean") fields[key] = { booleanValue: val };
    else if (Array.isArray(val)) {
      fields[key] = {
        arrayValue: {
          values: val.map((item) => {
            if (typeof item === "string") return { stringValue: item };
            if (typeof item === "number") return Number.isInteger(item) ? { integerValue: item.toString() } : { doubleValue: item };
            if (typeof item === "boolean") return { booleanValue: item };
            if (typeof item === "object") return { mapValue: { fields: wrapFirestoreFields(item) } };
            return { stringValue: String(item) };
          })
        }
      };
    } else if (typeof val === "object") {
      fields[key] = { mapValue: { fields: wrapFirestoreFields(val) } };
    }
  }
  return fields;
}

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
  // CORS setup
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader("Access-Control-Allow-Headers", "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    const { userId, amount, utr, client_txn_id } = req.body || {};
    if (!userId || !amount || !utr) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const cleanUtr = String(utr).replace(/\D/g, "");
    if (cleanUtr.length !== 12) {
      return res.status(400).json({ error: "Invalid UTR format. Expected 12 digits." });
    }

    const authHeader = req.headers.authorization;
    const headers: any = { "Content-Type": "application/json" };
    if (authHeader) headers["Authorization"] = authHeader;

    // 1. Check if UTR already used
    const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents:runQuery?key=${FIREBASE_API_KEY}`;
    try {
      const checkRes = await axios.post(queryUrl, {
        structuredQuery: {
          from: [{ collectionId: "deposits" }],
          where: {
            compositeFilter: {
              op: "AND",
              filters: [
                {
                  fieldFilter: {
                    field: { fieldPath: "utr" },
                    op: "EQUAL",
                    value: { stringValue: cleanUtr }
                  }
                },
                {
                  fieldFilter: {
                    field: { fieldPath: "status" },
                    op: "EQUAL",
                    value: { stringValue: "approved" }
                  }
                }
              ]
            }
          },
          limit: 1
        }
      }, { headers, timeout: 5000 });

      if (Array.isArray(checkRes.data) && checkRes.data.some((item: any) => item.document)) {
        return res.status(400).json({ error: "This UTR has already been used and verified." });
      }
    } catch (e: any) {}

    // 2. Get Settings
    const settingsUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/settings/payment?key=${FIREBASE_API_KEY}`;
    let settings: any = {};
    try {
      const sRes = await axios.get(settingsUrl, { headers, timeout: 5000 });
      if (sRes.data && sRes.data.fields) {
        settings = unwrapDoc(sRes.data);
      }
    } catch (e) {}

    if (!settings.qrAutoEnabled) {
      return res.status(400).json({ error: "Automatic QR verification is disabled by admin." });
    }

    const { qrAutoProvider, qrAutoApiKey, qrAutoToken, qrAutoUrl } = settings;
    let isVerified = false;

    if (qrAutoProvider === "smmqr") {
      const verifyUrl = qrAutoUrl || "https://smmqr.com/api/v1/verify-payment";
      try {
        const apiRes = await axios.get(verifyUrl, {
          params: { api_key: qrAutoApiKey, token: qrAutoToken, utr: cleanUtr, amount },
          timeout: 15000
        });
        if (apiRes.data.status === "success" || apiRes.data.success === true || apiRes.data.msg?.toLowerCase().includes("success")) {
          isVerified = true;
        }
      } catch (apiErr: any) {
        return res.status(500).json({ error: "Gateway connection failed. Please try manual verification." });
      }
    } else if (qrAutoProvider === "vpaapi") {
      const verifyUrl = qrAutoUrl || "https://vpaapi.com/api/verify";
      try {
        const apiRes = await axios.post(verifyUrl, {
          api_key: qrAutoApiKey,
          utr: cleanUtr,
          amount
        }, { timeout: 15000 });
        if (apiRes.data.status === "success" || apiRes.data.success === true) {
          isVerified = true;
        }
      } catch (apiErr: any) {
        return res.status(500).json({ error: "Gateway connection failed." });
      }
    } else if (qrAutoProvider === "upigateway") {
      const verifyUrl = qrAutoUrl || "https://api.upigateway.com/api/v1/verify_payment";
      try {
        const apiRes = await axios.post(verifyUrl, {
          key: qrAutoApiKey,
          utr: cleanUtr,
          client_txn_id: client_txn_id
        }, { timeout: 15000 });
        if (apiRes.data.status === true || apiRes.data.msg?.toLowerCase().includes("success")) {
          isVerified = true;
          if (apiRes.data.data && apiRes.data.data.amount) {
            if (Number(apiRes.data.data.amount) < Number(amount)) {
              return res.status(400).json({ error: `Amount mismatch. Found ₹${apiRes.data.data.amount} for this UTR.` });
            }
          }
        }
      } catch (apiErr: any) {
        return res.status(500).json({ error: "UPIGateway verification failed. Please check UTR or use manual proof." });
      }
    }

    if (!isVerified) {
      return res.status(400).json({ error: "Payment verification failed or not found at payment gateway." });
    }

    // Add balance to user
    const userUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/users/${userId}?key=${FIREBASE_API_KEY}`;
    let newBalance = 0;
    try {
      const uRes = await axios.get(userUrl, { headers, timeout: 5000 });
      if (uRes.data && uRes.data.fields) {
        const currentBalance = Number(uRes.data.fields.balance?.integerValue || uRes.data.fields.balance?.doubleValue || 0);
        newBalance = Number((currentBalance + Number(amount)).toFixed(2));
        await axios.patch(userUrl + "&updateMask.fieldPaths=balance", {
          fields: { balance: { doubleValue: newBalance } }
        }, { headers, timeout: 5000 });
      }
    } catch (e: any) {
      return res.status(500).json({ error: "Payment verified but failed to update wallet. Contact support." });
    }

    // Create deposit document
    const depositId = `qr_${Date.now()}_${cleanUtr.slice(-4)}`;
    const depositDoc = {
      id: depositId,
      userId,
      amount: Number(amount),
      utr: cleanUtr,
      status: "approved",
      type: "deposit",
      method: "qr_auto",
      gateway: qrAutoProvider || "auto_qr",
      verifiedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };

    const depUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/deposits/${depositId}?key=${FIREBASE_API_KEY}`;
    await axios.patch(depUrl, { fields: wrapFirestoreFields(depositDoc) }, { headers, timeout: 5000 }).catch(() => {});

    return res.status(200).json({
      success: true,
      amount: Number(amount),
      newBalance,
      depositId
    });
  } catch (err: any) {
    console.error("[VERCEL-QR-AUTO] Error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
