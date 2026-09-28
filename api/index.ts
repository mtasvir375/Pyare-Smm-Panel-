import axios from "axios";

// Environment & Configuration
const FIREBASE_PROJECT_ID = "gen-lang-client-0629912823";
const FIREBASE_DATABASE_ID = "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";
const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY || "AIzaSyBW_IUbuocn83oBCfQfbZsGbswo-OcgxRY";

// --- FIRESTORE REST HELPERS (SELF-CONTAINED - NO EXTERNAL IMPORTS) ---

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

function wrapFirestoreFields(data: any): any {
  const fields: any = {};
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (val === undefined || val === null) continue;
    if (typeof val === "string") {
      fields[key] = { stringValue: val };
    } else if (typeof val === "number") {
      if (Number.isInteger(val)) {
        fields[key] = { integerValue: val.toString() };
      } else {
        fields[key] = { doubleValue: val };
      }
    } else if (typeof val === "boolean") {
      fields[key] = { booleanValue: val };
    } else if (Array.isArray(val)) {
      fields[key] = {
        arrayValue: {
          values: val.map((item) => {
            if (typeof item === "string") return { stringValue: item };
            if (typeof item === "number") {
              return Number.isInteger(item)
                ? { integerValue: item.toString() }
                : { doubleValue: item };
            }
            if (typeof item === "boolean") return { booleanValue: item };
            if (typeof item === "object" && item !== null) {
              return { mapValue: { fields: wrapFirestoreFields(item) } };
            }
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

async function getRestDoc(collection: string, docId: string): Promise<any> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_API_KEY}`;
    const res = await axios.get(url, { timeout: 7000 });
    return res.data ? unwrapFirestoreFields(res.data.fields) : null;
  } catch (err: any) {
    if (err.response && err.response.status === 404) return null;
    throw err;
  }
}

async function setRestDoc(collection: string, docId: string, data: any): Promise<any> {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_API_KEY}`;
  const fields = wrapFirestoreFields(data);
  const res = await axios.patch(url, { fields }, { timeout: 8000 });
  return res.data ? unwrapFirestoreFields(res.data.fields) : null;
}

async function listRestDocs(collection: string, pageSize = 100): Promise<any[]> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents:runQuery?key=${FIREBASE_API_KEY}`;
    const payload = {
      structuredQuery: {
        from: [{ collectionId: collection }],
        limit: pageSize
      }
    };
    const res = await axios.post(url, payload, { timeout: 8000 });
    if (res.data && Array.isArray(res.data)) {
      return res.data
        .filter((item: any) => item.document)
        .map((item: any) => {
          const doc = item.document;
          const id = doc.name.split("/").pop();
          const data = unwrapFirestoreFields(doc.fields || {});
          return { id, ...data };
        });
    }
    return [];
  } catch (err: any) {
    console.error(`[REST-QUERY-ERR] Failed for ${collection}:`, err.response?.data || err.message);
    return [];
  }
}

// Known Providers for proxy
const KNOWN_PROVIDERS: Record<string, { apiUrl: string; apiKey: string; name: string }> = {
  "talVdnSEg8QGpNVpaUTi": {
    name: "Wholesale Smm Store",
    apiUrl: "https://wholesalesmmstore.com/api/v2",
    apiKey: "e88f2599c82bf15a44b759e61f63673ceae954b8"
  },
  "BjKqhBjQkzJ6y1GIYf5R": {
    name: "Wholesale Smm Store",
    apiUrl: "https://wholesalesmmstore.com/api/v2",
    apiKey: "e88f2599c82bf15a44b759e61f63673ceae954b8"
  },
  "z4luhVVgYKgHULKPXj8j": {
    name: "The main smm provider",
    apiUrl: "https://themainsmmprovider.com/api/v2",
    apiKey: "e104906e7686a6177f614c7ddbe0a240124a1795"
  },
  "k7IIPgA8QcpGmZGul3Pw": {
    name: "The main smm provider",
    apiUrl: "https://themainsmmprovider.com/api/v2",
    apiKey: "e104906e7686a6177f614c7ddbe0a240124a1795"
  },
  "z9lfdj7ByNCeGNO6WbGZ": {
    name: "Smm bin",
    apiUrl: "https://smmbin.com/api/v2",
    apiKey: "f55bb2dfdc035f9c3c9e737bb72922a51d64309f"
  },
  "GbtZDOMSvSrBPgeRy6aU": {
    name: "Smm bin",
    apiUrl: "https://smmbin.com/api/v2",
    apiKey: "f55bb2dfdc035f9c3c9e737bb72922a51d64309f"
  }
};

// --- MASTER VERCEL SERVERLESS FUNCTION HANDLER ---

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,PATCH,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Date, X-Api-Version"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Parse path from req.url
  const rawUrl = req.url || "/api";
  const urlObj = new URL(rawUrl, "http://localhost");
  let pathname = urlObj.pathname.replace(/\/+$/, "") || "/api";
  if (req.query?.path && Array.isArray(req.query.path)) {
    pathname = `/api/${req.query.path.join("/")}`;
  }

  // Ensure body is parsed if sent as JSON string
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  if (!body) body = {};

  try {
    // 1. Health check: /api
    if (pathname === "/api" || pathname === "") {
      return res.status(200).json({ status: "ok", message: "API Gateway Online", timestamp: new Date().toISOString() });
    }

    // 2. Settings: /api/settings
    if (pathname === "/api/settings") {
      if (req.method === "GET") {
        try {
          const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/settings/payment?key=${FIREBASE_API_KEY}`;
          const response = await axios.get(url, { timeout: 6000 });
          const data = unwrapFirestoreFields(response.data.fields);
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
          return res.status(200).json(data);
        } catch (err: any) {
          return res.status(200).json({
            upiId: "mdsaudalam621@okicici",
            merchantName: "Pyare SMM Panel",
            instantQrEnabled: true,
            manualQrEnabled: true
          });
        }
      } else if (req.method === "POST") {
        await setRestDoc("settings", "payment", body);
        return res.status(200).json({ success: true, message: "Settings saved" });
      }
    }

    // 3. Courses: /api/courses
    if (pathname === "/api/courses") {
      if (req.method === "GET") {
        try {
          const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/courses?pageSize=300&key=${FIREBASE_API_KEY}`;
          const response = await axios.get(url, { timeout: 7000 });
          const documents = response.data.documents || [];
          const courses = documents.map((doc: any) => {
            const parts = doc.name.split("/");
            const id = parts[parts.length - 1];
            const data = unwrapFirestoreFields(doc.fields);
            return { id, ...data };
          });
          const categoryOrder = ["Instagram", "YouTube", "Facebook", "TikTok", "Telegram", "Twitter", "Other"];
          courses.sort((a: any, b: any) => {
            const idxA = categoryOrder.indexOf(a.category || "Other");
            const idxB = categoryOrder.indexOf(b.category || "Other");
            if (idxA !== idxB) return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
            return (a.serviceId || 0) - (b.serviceId || 0);
          });
          res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
          return res.status(200).json(courses);
        } catch (err: any) {
          return res.status(500).json({ error: err.message });
        }
      }
    }

    // 4. Providers: /api/providers
    if (pathname === "/api/providers") {
      if (req.method === "GET") {
        try {
          const providers = await listRestDocs("providers", 100);
          return res.status(200).json(providers);
        } catch (err: any) {
          return res.status(500).json({ error: err.message });
        }
      }
    }

    // 5. Proxy Provider: /api/proxy-provider
    if (pathname === "/api/proxy-provider" || pathname === "/api/proxy") {
      const { providerId, action, service, link, quantity, runs, interval } = body || {};
      let apiUrl = "";
      let apiKey = "";

      if (providerId && KNOWN_PROVIDERS[providerId]) {
        apiUrl = KNOWN_PROVIDERS[providerId].apiUrl;
        apiKey = KNOWN_PROVIDERS[providerId].apiKey;
      } else if (providerId) {
        try {
          const pDoc = await getRestDoc("providers", providerId);
          if (pDoc) {
            apiUrl = pDoc.apiUrl || pDoc.url;
            apiKey = pDoc.apiKey || pDoc.key;
          }
        } catch (e) {}
      }

      if (!apiUrl || !apiKey) {
        apiUrl = "https://smmbin.com/api/v2";
        apiKey = "f55bb2dfdc035f9c3c9e737bb72922a51d64309f";
      }

      const params = new URLSearchParams();
      params.append("key", apiKey);
      params.append("action", action || "add");
      if (service) params.append("service", String(service));
      if (link) params.append("link", String(link));
      if (quantity) params.append("quantity", String(quantity));
      if (runs) params.append("runs", String(runs));
      if (interval) params.append("interval", String(interval));

      try {
        const provRes = await axios.post(apiUrl, params.toString(), {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 30000
        });
        return res.status(200).json(provRes.data);
      } catch (err: any) {
        return res.status(500).json({ error: err.response?.data || err.message });
      }
    }

    // 6. Telegram Config: /api/telegram-config or /api/admin/telegram-config
    if (pathname === "/api/telegram-config" || pathname === "/api/admin/telegram-config") {
      if (req.method === "GET") {
        let cfg: any = null;
        try {
          cfg = await getRestDoc("settings", "telegram_bot");
        } catch {}

        if (!cfg) {
          return res.status(200).json({
            success: true,
            running: false,
            enabled: false,
            hasToken: false,
            maskedToken: "",
            chatId: "",
            botUsername: ""
          });
        }

        const botToken = String(cfg.botToken || "").trim();
        let masked = "";
        if (botToken.length > 8) {
          const parts = botToken.split(":");
          masked = parts.length === 2 ? `${parts[0]}:***${parts[1].slice(-4)}` : `${botToken.slice(0, 4)}***${botToken.slice(-4)}`;
        }

        return res.status(200).json({
          success: true,
          running: !!cfg.enabled,
          enabled: !!cfg.enabled,
          hasToken: !!botToken,
          maskedToken: masked,
          chatId: cfg.chatId || "",
          botUsername: cfg.botUsername || ""
        });
      } else if (req.method === "POST") {
        let current: any = {};
        try {
          current = (await getRestDoc("settings", "telegram_bot")) || {};
        } catch {}

        const updated = {
          ...current,
          ...(body.botToken !== undefined && { botToken: String(body.botToken).trim() }),
          ...(body.chatId !== undefined && { chatId: String(body.chatId).trim() }),
          ...(body.enabled !== undefined && { enabled: !!body.enabled }),
          ...(body.botUsername !== undefined && { botUsername: String(body.botUsername).trim() }),
          updatedAt: new Date().toISOString()
        };

        await setRestDoc("settings", "telegram_bot", updated);
        return res.status(200).json({ success: true, message: "Telegram configuration saved." });
      }
    }

    // 7. Dynamic Payment Intent: /api/payments/create-intent
    if (pathname === "/api/payments/create-intent") {
      if (req.method === "POST") {
        const { amount, userId, userEmail } = body || {};
        const numAmount = Number(amount);
        if (!numAmount || isNaN(numAmount) || numAmount < 1) {
          return res.status(400).json({ success: false, error: "Minimum deposit amount is ₹1." });
        }
        if (!userId) {
          return res.status(400).json({ success: false, error: "User ID is required." });
        }

        let settings: any = {};
        try {
          settings = (await getRestDoc("settings", "payment")) || {};
        } catch {}

        const upiId = (settings.upiId || "mdsaudalam621@okicici").trim();
        const payeeName = (settings.merchantName || "Pyare SMM Panel").trim();

        // 12-digit numeric Order Reference
        const part1 = Math.floor(100000 + Math.random() * 900000).toString();
        const part2 = Math.floor(100000 + Math.random() * 900000).toString();
        const orderRef = `${part1}${part2}`;

        const now = Date.now();
        const intentId = `pi_${now}_${Math.random().toString(36).substring(2, 7)}`;
        const expiresAt = now + 30 * 60 * 1000;
        const finalAmount = numAmount;

        const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&am=${finalAmount.toFixed(2)}&tr=${orderRef}&tn=${orderRef}&cu=INR`;

        const intentData = {
          intentId,
          orderRef,
          baseAmount: numAmount,
          amount: finalAmount,
          userId: String(userId),
          userEmail: userEmail ? String(userEmail) : "",
          upiId,
          payeeName,
          upiLink,
          status: "pending",
          createdAt: now,
          expiresAt,
          notified: false
        };

        try {
          await setRestDoc("payment_intents", intentId, intentData);
        } catch (dbErr: any) {
          console.warn("[INTENT-SAVE-WARN]", dbErr.message);
        }

        return res.status(200).json({
          success: true,
          intentId,
          orderRef,
          baseAmount: numAmount,
          amount: finalAmount,
          upiId,
          payeeName,
          upiLink,
          expiresAt
        });
      }
    }

    // 8. Check Payment Intent: /api/payments/check-intent or /api/payments/check-intent/:intentId
    if (pathname.startsWith("/api/payments/check-intent")) {
      const parts = pathname.split("/").filter(Boolean);
      let intentId = parts.length > 3 ? parts[3] : (req.query?.intentId || req.query?.id);
      if (!intentId && pathname.includes("/check-intent/")) {
        intentId = pathname.substring(pathname.indexOf("/check-intent/") + 14);
      }

      if (!intentId) {
        return res.status(400).json({ success: false, error: "Missing intentId" });
      }

      const intent = await getRestDoc("payment_intents", String(intentId));
      if (!intent) {
        return res.status(200).json({
          success: true,
          status: "pending",
          intentId: String(intentId),
          message: "Awaiting bank SMS confirmation"
        });
      }

      let userBalance: number | undefined;
      if (intent.status === "completed" && intent.userId) {
        try {
          const uDoc = await getRestDoc("users", intent.userId);
          userBalance = uDoc?.balance;
        } catch (e) {}
      }

      return res.status(200).json({
        success: true,
        status: intent.status || "pending",
        intentId: intent.intentId,
        orderRef: intent.orderRef,
        amount: intent.amount,
        baseAmount: intent.baseAmount,
        creditedAmount: intent.amount,
        utr: intent.utr,
        expiresAt: intent.expiresAt,
        completedAt: intent.completedAt,
        newBalance: userBalance
      });
    }

    // 9. Verify UTR: /api/verify-utr or /api/deposits/verify-qr-auto or /api/wallet/verify-utr
    if (
      pathname === "/api/verify-utr" ||
      pathname === "/api/deposits/verify-qr-auto" ||
      pathname === "/api/wallet/verify-utr"
    ) {
      if (req.method === "POST") {
        const { userId, utr, amount: reqAmount, userEmail } = body || {};
        if (!userId) {
          return res.status(400).json({ success: false, error: "User authentication required." });
        }
        const cleanUtr = String(utr || "").replace(/\D/g, "").trim();
        if (cleanUtr.length !== 12) {
          return res.status(400).json({ success: false, error: "Please enter a valid 12-digit UPI / UTR Reference Number." });
        }

        let alertDoc = await getRestDoc("bank_alerts", cleanUtr);
        if (!alertDoc) {
          alertDoc = await getRestDoc("sms_forwarder_pool", cleanUtr);
        }

        if (!alertDoc) {
          return res.status(404).json({
            success: false,
            error: `Payment verification pending: No bank alert received for UTR ${cleanUtr} yet. If you just sent payment, please wait 15–30 seconds for the bank confirmation SMS to process, then click Verify again.`
          });
        }

        const isClaimed = alertDoc.isUsed === true || alertDoc.status === "claimed";
        if (isClaimed) {
          const claimedBy = alertDoc.usedBy || alertDoc.claimedBy;
          if (claimedBy === userId) {
            return res.status(200).json({
              success: true,
              amount: Number(alertDoc.amount || reqAmount || 0),
              message: "You have already verified and claimed this UTR."
            });
          }
          return res.status(400).json({
            success: false,
            error: `UTR ${cleanUtr} has already been claimed and credited to an account.`
          });
        }

        const creditAmount = Number(alertDoc.amount || reqAmount || 0);
        let newBalance = creditAmount;
        try {
          const userDoc = await getRestDoc("users", userId);
          const currentBal = Number(userDoc?.balance || 0);
          newBalance = currentBal + creditAmount;
          await setRestDoc("users", userId, { balance: newBalance });
        } catch (e) {}

        const nowIso = new Date().toISOString();
        await setRestDoc("bank_alerts", cleanUtr, {
          ...alertDoc,
          isUsed: true,
          status: "claimed",
          usedBy: userId,
          usedByEmail: userEmail || "",
          claimedBy: userId,
          claimedAt: nowIso
        });

        return res.status(200).json({
          success: true,
          amount: creditAmount,
          newBalance,
          message: `Successfully verified! ₹${creditAmount} added to your wallet.`
        });
      }
    }

    // 10. Bank Alerts: /api/bank-alerts or /api/admin/bank-alerts
    if (pathname === "/api/bank-alerts" || pathname === "/api/admin/bank-alerts") {
      if (req.method === "GET") {
        const alerts = await listRestDocs("bank_alerts", 50);
        return res.status(200).json(alerts);
      }
    }

    // Default 404
    return res.status(404).json({ success: false, error: `Route ${pathname} not found on Vercel Gateway` });
  } catch (err: any) {
    console.error("[API-GATEWAY-ERR]", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
