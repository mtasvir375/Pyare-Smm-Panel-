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
  "3eaZMZbSKVvMUbRI4kei": {
    name: "The main smm provider ♥️♥️",
    apiUrl: "https://themainsmmprovider.com/api/v2",
    apiKey: "a10c05a0cacf6ed5c83b55e374e690495b727586"
  },
  "z4luhVVgYKgHULKPXj8j": {
    name: "The main smm provider",
    apiUrl: "https://themainsmmprovider.com/api/v2",
    apiKey: "a10c05a0cacf6ed5c83b55e374e690495b727586"
  },
  "k7IIPgA8QcpGmZGul3Pw": {
    name: "The main smm provider",
    apiUrl: "https://themainsmmprovider.com/api/v2",
    apiKey: "a10c05a0cacf6ed5c83b55e374e690495b727586"
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
  },
  "1RmzJhc5ZeyOCU23uZMy": {
    name: "MainSMMpanel ♥️",
    apiUrl: "https://mainsmmpanel.in/api/v2",
    apiKey: "5a2749e1fdafdf50cd81f2137f9b5806"
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
          console.warn("[REST-SETTINGS-GET-ERR]", err.response?.data || err.message);
          return res.status(err.response?.status || 500).json({
            error: "Failed to fetch settings from Firestore REST API",
            message: err.message
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
      const {
        providerId,
        service,
        providerServiceId,
        link,
        targetLink,
        target_link,
        quantity,
        totalPrice,
        total_price,
        userId,
        user_id,
        userEmail,
        orderId,
        orderData,
        runs,
        interval
      } = body || {};

      let apiUrl = "";
      let apiKey = "";

      const resolvedProviderId = providerId || orderData?.providerId || "";
      if (resolvedProviderId && KNOWN_PROVIDERS[resolvedProviderId]) {
        apiUrl = KNOWN_PROVIDERS[resolvedProviderId].apiUrl;
        apiKey = KNOWN_PROVIDERS[resolvedProviderId].apiKey;
      } else if (resolvedProviderId) {
        try {
          const pDoc = await getRestDoc("providers", resolvedProviderId);
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

      const finalService = String(service || providerServiceId || orderData?.providerServiceId || "").trim();
      const finalLink = String(link || targetLink || target_link || orderData?.targetLink || "").trim();
      const finalQty = String(quantity || orderData?.quantity || "1000").trim();
      const finalUserId = String(userId || user_id || orderData?.userId || "").trim();
      const finalPrice = Number(totalPrice || total_price || orderData?.totalPrice || 0);

      // Verify user has sufficient balance before placing order
      let currentUserBal = 0;
      let userDoc: any = null;
      if (finalUserId) {
        try {
          userDoc = await getRestDoc("users", finalUserId);
          if (userDoc) {
            currentUserBal = Number(userDoc.balance || 0);
          }
        } catch (uErr) {}

        if (finalPrice > 0 && currentUserBal < finalPrice) {
          return res.status(400).json({
            success: false,
            error: `Insufficient balance (₹${currentUserBal.toFixed(2)}). Required: ₹${finalPrice.toFixed(2)}`,
            currentBalance: currentUserBal
          });
        }
      }

      const params = new URLSearchParams();
      params.append("key", apiKey);
      params.append("action", "add");
      if (finalService) params.append("service", finalService);
      if (finalLink) params.append("link", finalLink);
      if (finalQty) params.append("quantity", finalQty);
      if (runs) params.append("runs", String(runs));
      if (interval) params.append("interval", String(interval));
      params.append("terms", "1");
      params.append("agree", "1");

      try {
        const provRes = await axios.post(apiUrl, params.toString(), {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 35000
        });

        let resData = provRes.data;
        if (typeof resData === "string") {
          try {
            resData = JSON.parse(resData);
          } catch (e) {}
        }

        const providerOrderId =
          resData?.order ||
          resData?.order_id ||
          resData?.orderid ||
          resData?.orderId ||
          resData?.id ||
          resData?.ID ||
          (typeof resData === "number" ? String(resData) : null);

        const isSuccess =
          !!providerOrderId ||
          resData?.status === "success" ||
          resData?.success === true ||
          String(resData?.message || "").toLowerCase().includes("success");

        if (isSuccess) {
          const finalOId = providerOrderId ? String(providerOrderId) : "SUCCESS";
          let newBal = currentUserBal;

          // Deduct user balance
          if (finalUserId && finalPrice > 0) {
            newBal = Math.max(0, Number((currentUserBal - finalPrice).toFixed(2)));
            try {
              await setRestDoc("users", finalUserId, {
                ...userDoc,
                balance: newBal,
                lastOrderedAt: new Date().toISOString()
              });
            } catch (deductErr: any) {
              console.warn("[BALANCE-DEDUCT-WARN]", deductErr.message);
            }
          }

          // Save order in Firestore orders collection
          const finalOrderId = orderId || `ord_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          try {
            await setRestDoc("orders", finalOrderId, {
              id: finalOrderId,
              userId: finalUserId,
              userEmail: userEmail || orderData?.userEmail || "",
              serviceId: orderData?.serviceId || finalService,
              title: orderData?.title || "SMM Order",
              category: orderData?.category || "Other",
              quantity: Number(finalQty),
              targetLink: finalLink,
              totalPrice: finalPrice,
              status: "Completed",
              providerOrderId: finalOId,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
          } catch (ordSaveErr: any) {
            console.warn("[ORDER-SAVE-WARN]", ordSaveErr.message);
          }

          return res.status(200).json({
            success: true,
            providerOrderId: finalOId,
            newBalance: newBal,
            data: resData
          });
        } else {
          const errReason =
            resData?.error ||
            resData?.message ||
            resData?.msg ||
            resData?.reason ||
            "Provider did not accept the order";
          const cleanErr = typeof errReason === "string" ? errReason : JSON.stringify(errReason);
          return res.status(400).json({
            success: false,
            error: cleanErr,
            currentBalance: currentUserBal,
            data: resData
          });
        }
      } catch (err: any) {
        const errorDetail = err.response?.data?.error || err.response?.data?.message || err.response?.data || err.message;
        const cleanErr = typeof errorDetail === "string" ? errorDetail : JSON.stringify(errorDetail);
        return res.status(500).json({
          success: false,
          error: cleanErr,
          currentBalance: currentUserBal
        });
      }
    }

    // 6. Telegram Config: /api/telegram-config or /api/admin/telegram-config
    if (pathname === "/api/telegram-config" || pathname === "/api/admin/telegram-config") {
      if (req.method === "GET") {
        let cfg: any = null;
        let paymentCfg: any = null;
        try {
          cfg = await getRestDoc("settings", "telegram_bot");
        } catch {}
        try {
          paymentCfg = await getRestDoc("settings", "payment");
        } catch {}

        const botToken = String(cfg?.botToken || paymentCfg?.telegramBotToken || paymentCfg?.botToken || "").trim();
        const chatId = String(cfg?.chatId || paymentCfg?.telegramChatId || paymentCfg?.chatId || "").trim();
        const isEnabled = cfg?.enabled ?? paymentCfg?.telegramBotEnabled ?? true;
        const isActive = !!(botToken && botToken.length >= 30 && isEnabled !== false);

        let masked = "";
        if (botToken.length > 8) {
          const parts = botToken.split(":");
          masked = parts.length === 2 ? `${parts[0]}:***${parts[1].slice(-4)}` : `${botToken.slice(0, 4)}***${botToken.slice(-4)}`;
        }

        return res.status(200).json({
          success: true,
          running: isActive,
          enabled: isActive,
          hasToken: !!botToken,
          maskedToken: masked,
          chatId,
          botUsername: cfg?.botUsername || paymentCfg?.telegramBotUsername || ""
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

      // Auto-reconcile against Firestore bank_alerts & sms_forwarder_pool if still pending
      if (intent.status !== "completed" && intent.userId) {
        try {
          const [bankAlerts, smsPool] = await Promise.all([
            listRestDocs("bank_alerts", 50),
            listRestDocs("sms_forwarder_pool", 50)
          ]);
          const combinedAlerts = [...bankAlerts, ...smsPool];
          const intentCreatedTime = Number(intent.createdAt || 0);

          const match = combinedAlerts.find((a: any) => {
            if (!a || a.isUsed === true || a.status === "claimed") return false;

            let alertTime = 0;
            if (typeof a.timestamp === "number") alertTime = a.timestamp;
            else if (typeof a.timestamp === "string") alertTime = new Date(a.timestamp).getTime();

            // STRICT TIMING GUARD: Alert MUST be generated AFTER or within 60s before payment intent was created
            if (intentCreatedTime > 0 && alertTime > 0 && alertTime < (intentCreatedTime - 60000)) {
              return false; // Ignore old bank alerts from previous sessions
            }

            const utrStr = String(a.utr || "").trim();
            const textStr = String(a.rawText || a.rawSms || "").trim();
            const orderRef = String(intent.orderRef || "").trim();

            // 1. Match by exact 12-digit Order Ref in UTR or SMS text
            if (utrStr && orderRef && utrStr.toLowerCase() === orderRef.toLowerCase()) return true;
            if (orderRef && textStr.includes(orderRef)) return true;

            // 2. Match by exact assigned decimal amount IF alert arrived after intent creation
            if (typeof a.amount === "number" && Math.abs(a.amount - intent.amount) < 0.005 && alertTime >= (intentCreatedTime - 60000)) {
              return true;
            }

            return false;
          });

          if (match) {
            const matchUtr = match.utr || intent.orderRef;
            const creditAmt = Number(intent.amount || match.amount || 0);

            // Fetch current user balance
            let currentBal = 0;
            let uDoc: any = null;
            try {
              uDoc = await getRestDoc("users", intent.userId);
              currentBal = Number(uDoc?.balance || 0);
            } catch (e) {}

            const newBal = Number((currentBal + creditAmt).toFixed(2));

            // Persist updated balance & completed intent
            await Promise.all([
              setRestDoc("users", intent.userId, { balance: newBal, updatedAt: new Date().toISOString() }),
              setRestDoc("payment_intents", intent.intentId, {
                ...intent,
                status: "completed",
                completedAt: Date.now(),
                utr: matchUtr,
                creditedAmount: creditAmt
              }),
              setRestDoc("bank_alerts", matchUtr, {
                ...match,
                isUsed: true,
                status: "claimed",
                usedBy: intent.userId,
                usedAt: new Date().toISOString()
              })
            ]);

            intent.status = "completed";
            intent.utr = matchUtr;
            intent.completedAt = Date.now();

            return res.status(200).json({
              success: true,
              status: "completed",
              intentId: intent.intentId,
              orderRef: intent.orderRef,
              amount: creditAmt,
              baseAmount: intent.baseAmount,
              creditedAmount: creditAmt,
              utr: matchUtr,
              expiresAt: intent.expiresAt,
              completedAt: intent.completedAt,
              newBalance: newBal
            });
          }
        } catch (reconcileErr: any) {
          console.warn("[CHECK-INTENT-AUTO-RECONCILE-WARN]", reconcileErr.message);
        }
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

    // 11. Generic DB Proxy Endpoints: /api/db/get, /api/db/set, /api/db/update, /api/db/list, /api/db/add
    if (pathname === "/api/db/get") {
      const { collection: colName, id } = body || {};
      if (!colName || !id) return res.status(400).json({ success: false, error: "Missing collection or id" });
      const data = await getRestDoc(colName, id);
      return res.status(200).json({ success: true, data });
    }

    if (pathname === "/api/db/set") {
      const { collection: colName, id, data } = body || {};
      if (!colName || !id) return res.status(400).json({ success: false, error: "Missing collection or id" });
      const saved = await setRestDoc(colName, id, data || {});
      return res.status(200).json({ success: true, data: saved });
    }

    if (pathname === "/api/db/update") {
      const { collection: colName, id, data } = body || {};
      if (!colName || !id) return res.status(400).json({ success: false, error: "Missing collection or id" });
      const updated = await setRestDoc(colName, id, data || {});
      return res.status(200).json({ success: true, data: updated });
    }

    if (pathname === "/api/db/list" || pathname === "/api/db/query") {
      const { collection: colName, limit: queryLimit } = body || {};
      if (!colName) return res.status(400).json({ success: false, error: "Missing collection" });
      const docs = await listRestDocs(colName, queryLimit || 100);
      return res.status(200).json({ success: true, data: docs });
    }

    if (pathname === "/api/db/add") {
      const { collection: colName, data } = body || {};
      if (!colName) return res.status(400).json({ success: false, error: "Missing collection" });
      const autoId = `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const saved = await setRestDoc(colName, autoId, { id: autoId, ...(data || {}) });
      return res.status(200).json({ success: true, id: autoId, data: saved });
    }

    // 12. Admin User Management: /api/admin/search-user & /api/admin/update-balance
    if (pathname === "/api/admin/search-user") {
      const queryStr = String(body.query || body.email || "").toLowerCase().trim();
      const allUsers = await listRestDocs("users", 100);
      let matched = allUsers;
      if (queryStr) {
        matched = allUsers.filter((u: any) => {
          const uEmail = String(u.email || u.userEmail || "").toLowerCase();
          const uName = String(u.displayName || u.name || "").toLowerCase();
          const uId = String(u.id || u.uid || "").toLowerCase();
          return uEmail.includes(queryStr) || uName.includes(queryStr) || uId.includes(queryStr);
        });
      }
      return res.status(200).json({ success: true, users: matched });
    }

    if (pathname === "/api/admin/update-balance") {
      const { userId, id, balance } = body || {};
      const targetId = userId || id;
      if (!targetId) return res.status(400).json({ success: false, error: "Missing userId" });
      const numBal = Number(balance || 0);
      await setRestDoc("users", targetId, { balance: numBal, updatedAt: new Date().toISOString() });
      return res.status(200).json({ success: true, balance: numBal });
    }

    // 13. UPI Gateway & Telegram Config: /api/admin/upi-gateway-config
    if (pathname === "/api/admin/upi-gateway-config") {
      if (body.action === "save") {
        const upiId = body.upiId ? String(body.upiId).trim() : undefined;
        const payeeName = body.payeeName || body.merchantName ? String(body.payeeName || body.merchantName).trim() : undefined;
        const botToken = body.botToken || body.telegramBotToken ? String(body.botToken || body.telegramBotToken).trim() : undefined;
        const chatId = body.chatId || body.telegramChatId ? String(body.chatId || body.telegramChatId).trim() : undefined;

        const curPayment = (await getRestDoc("settings", "payment").catch(() => ({}))) || {};
        const curTg = (await getRestDoc("settings", "telegram_bot").catch(() => ({}))) || {};

        const updatedPayment = {
          ...curPayment,
          ...(upiId && { upiId }),
          ...(payeeName && { merchantName: payeeName }),
          ...(botToken && { telegramBotToken: botToken }),
          ...(chatId && { telegramChatId: chatId }),
          instantQrEnabled: body.instantQrEnabled !== undefined ? body.instantQrEnabled : curPayment.instantQrEnabled
        };

        const updatedTg = {
          ...curTg,
          ...(botToken && { botToken }),
          ...(chatId && { chatId }),
          ...(upiId && { upiId }),
          ...(payeeName && { payeeName }),
          enabled: body.enabled !== undefined ? !!body.enabled : true,
          updatedAt: new Date().toISOString()
        };

        await Promise.all([
          setRestDoc("settings", "payment", updatedPayment),
          setRestDoc("settings", "telegram_bot", updatedTg)
        ]);

        return res.status(200).json({
          success: true,
          message: "Config saved successfully",
          running: true,
          enabled: true,
          hasToken: !!(botToken || curTg.botToken),
          botToken: botToken || curTg.botToken,
          chatId: chatId || curTg.chatId,
          upiId: upiId || curPayment.upiId,
          payeeName: payeeName || curPayment.merchantName,
          config: updatedPayment
        });
      } else {
        const [settings, tgDoc] = await Promise.all([
          getRestDoc("settings", "payment").catch(() => ({})),
          getRestDoc("settings", "telegram_bot").catch(() => ({}))
        ]);

        const botToken = String(tgDoc?.botToken || settings?.telegramBotToken || settings?.botToken || "").trim();
        const chatId = String(tgDoc?.chatId || settings?.telegramChatId || settings?.chatId || "").trim();
        const isEnabled = tgDoc?.enabled ?? settings?.telegramBotEnabled ?? true;
        const isActive = !!(botToken && botToken.length >= 30 && isEnabled !== false);

        let masked = "";
        if (botToken.length > 8) {
          const parts = botToken.split(":");
          masked = parts.length === 2 ? `${parts[0]}:***${parts[1].slice(-4)}` : `${botToken.slice(0, 4)}***${botToken.slice(-4)}`;
        }

        return res.status(200).json({
          success: true,
          running: isActive,
          enabled: isActive,
          hasToken: !!botToken,
          maskedToken: masked,
          botToken,
          chatId,
          botUsername: tgDoc?.botUsername || settings?.telegramBotUsername || "",
          upiId: settings?.upiId || tgDoc?.upiId || "mdsaudalam621@okicici",
          payeeName: settings?.merchantName || tgDoc?.payeeName || "Pyare SMM Panel",
          config: {
            upiId: settings?.upiId || tgDoc?.upiId || "mdsaudalam621@okicici",
            payeeName: settings?.merchantName || tgDoc?.payeeName || "Pyare SMM Panel",
            enabled: isActive
          }
        });
      }
    }

    // 14. User Deposits History: /api/user/deposits
    if (pathname === "/api/user/deposits") {
      const targetUid = String(req.query?.userId || "").trim();
      const targetEmail = String(req.query?.email || "").trim().toLowerCase();

      if (!targetUid && !targetEmail) {
        return res.status(400).json({ success: false, error: "Missing userId or email" });
      }

      const depositMap = new Map<string, any>();

      try {
        const [depList, intentList] = await Promise.all([
          listRestDocs("deposits", 100),
          listRestDocs("payment_intents", 100)
        ]);

        for (const item of depList) {
          if (!item) continue;
          const uUid = String(item.userId || item.user_id || "").trim();
          const uEmail = String(item.userEmail || item.user_email || "").trim().toLowerCase();
          if ((targetUid && uUid === targetUid) || (targetEmail && uEmail && uEmail === targetEmail)) {
            depositMap.set(item.id, item);
          }
        }

        for (const item of intentList) {
          if (!item || item.status !== "completed") continue;
          const uUid = String(item.userId || "").trim();
          const uEmail = String(item.userEmail || "").trim().toLowerCase();
          if ((targetUid && uUid === targetUid) || (targetEmail && uEmail && uEmail === targetEmail)) {
            const depId = `intent_${item.intentId}`;
            if (!depositMap.has(depId)) {
              depositMap.set(depId, {
                id: depId,
                userId: item.userId,
                userEmail: item.userEmail,
                amount: item.amount,
                status: "approved",
                utr: item.utr || item.orderRef,
                orderRef: item.orderRef,
                method: "Instant UPI QR",
                gateway: item.senderBank || "Instant QR",
                createdAt: item.completedAt ? new Date(item.completedAt).toISOString() : (item.createdAt ? new Date(item.createdAt).toISOString() : new Date().toISOString())
              });
            }
          }
        }
      } catch (e: any) {
        console.warn("[USER-DEPOSITS-ERR]", e.message);
      }

      const deposits = Array.from(depositMap.values()).sort((a, b) => {
        const timeA = new Date(a.createdAt || a.timestamp || 0).getTime();
        const timeB = new Date(b.createdAt || b.timestamp || 0).getTime();
        return timeB - timeA;
      });

      return res.status(200).json({ success: true, deposits });
    }

    // Default 404
    return res.status(404).json({ success: false, error: `Route ${pathname} not found on Vercel Gateway` });
  } catch (err: any) {
    console.error("[API-GATEWAY-ERR]", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
