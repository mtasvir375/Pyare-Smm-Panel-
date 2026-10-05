import axios from "axios";
import { createClient } from "@libsql/client/web";

const TURSO_URL = process.env.TURSO_DATABASE_URL || process.env.TURSO_URL || "libsql://pyare-smm-panel-pyaresmmpanel.aws-ap-south-1.turso.io";
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || process.env.TURSO_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTEwNjQ0NzgsImlkIjoiMDFhMTAzYzEtNzYwMS03NDk5LTljYWMtYzdkMDExOWU5M2ZkIiwia2lkIjoiYVFCV3BPanpQSVA2czQzcGlrZ29pbkJtVlNodDZOTmh0YndUejBpaDRGOCIsInJpZCI6IjM0MTg2ZDIxLTgwYTUtNDU1YS1hOWQ3LWJhNGQzZTJlNTIzYSJ9.MXelOKfVsMZZoYfKiflhegiqqXQD5-0HN_faUU4z7WtQdjiQQTWXpU-i8jF1DiQrRpFUUV5wol-7dikl8pW5Dw";

const FIREBASE_PROJECT_ID = "gen-lang-client-0629912823";
const FIREBASE_DATABASE_ID = "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";
const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY || "AIzaSyBW_IUbuocn83oBCfQfbZsGbswo-OcgxRY";

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
  },
  "doc_1791067476261_cjt5c": {
    name: "Smm bin (Primary)",
    apiUrl: "https://www.smmbin.com/api/v2",
    apiKey: "f55bb2dfdc035f9c3c9e737bb72922a51d64309f"
  }
};

function getTurso() {
  try {
    return createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
  } catch (e) {
    return null;
  }
}

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (e) {}
    }
    body = body || {};

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
    } = body;

    let apiUrl = String(body.providerApiUrl || body.apiUrl || "").trim();
    let apiKey = String(body.providerApiKey || body.apiKey || "").trim();
    const resolvedProviderId = String(providerId || orderData?.providerId || "").trim();

    // 1. Resolve from known providers
    if ((!apiUrl || !apiKey) && resolvedProviderId && KNOWN_PROVIDERS[resolvedProviderId]) {
      if (!apiUrl) apiUrl = KNOWN_PROVIDERS[resolvedProviderId].apiUrl;
      if (!apiKey) apiKey = KNOWN_PROVIDERS[resolvedProviderId].apiKey;
    }

    // 2. Resolve from Turso database
    if ((!apiUrl || !apiKey) && resolvedProviderId) {
      try {
        const client = getTurso();
        if (client) {
          const pRes = await client.execute({
            sql: `SELECT api_url, api_key FROM smm_providers WHERE id = ? LIMIT 1;`,
            args: [resolvedProviderId]
          });
          if (pRes.rows.length > 0) {
            if (!apiUrl) apiUrl = String(pRes.rows[0].api_url || "").trim();
            if (!apiKey) apiKey = String(pRes.rows[0].api_key || "").trim();
          }
        }
      } catch (tErr) {}
    }

    // 3. Fallback defaults to Smm bin
    if (!apiUrl || !apiKey) {
      apiUrl = "https://www.smmbin.com/api/v2";
      apiKey = "f55bb2dfdc035f9c3c9e737bb72922a51d64309f";
    }

    if (!apiUrl.startsWith("http")) apiUrl = "https://" + apiUrl;

    const finalService = String(service || providerServiceId || orderData?.providerServiceId || "4545").trim();
    const finalLink = String(link || targetLink || target_link || orderData?.targetLink || "").trim();
    const finalQty = String(quantity || orderData?.quantity || "1000").trim();
    const finalUserId = String(userId || user_id || orderData?.userId || "").trim();
    const finalPrice = Number(totalPrice || total_price || orderData?.totalPrice || 0);

    // Verify user balance from Turso
    let currentUserBal = 0;
    let existingUserDoc: any = null;
    if (finalUserId) {
      try {
        const client = getTurso();
        if (client) {
          // Check smm_users table
          const uRes = await client.execute({
            sql: `SELECT balance, email, data FROM smm_users WHERE id = ? LIMIT 1;`,
            args: [finalUserId]
          });
          if (uRes.rows.length > 0) {
            currentUserBal = Number(uRes.rows[0].balance || 0);
            try {
              existingUserDoc = typeof uRes.rows[0].data === "string" ? JSON.parse(uRes.rows[0].data) : uRes.rows[0].data;
            } catch (e) {}
          } else {
            // Check smm_documents table
            const dRes = await client.execute({
              sql: `SELECT data FROM smm_documents WHERE collection = 'users' AND id = ? LIMIT 1;`,
              args: [finalUserId]
            });
            if (dRes.rows.length > 0) {
              const d = typeof dRes.rows[0].data === "string" ? JSON.parse(dRes.rows[0].data) : dRes.rows[0].data;
              currentUserBal = Number(d?.balance || 0);
              existingUserDoc = d;
            }
          }
        }
      } catch (uErr) {}

      if (finalPrice > 0 && currentUserBal < finalPrice) {
        return res.status(400).json({
          success: false,
          error: `Insufficient balance (₹${currentUserBal.toFixed(2)}). Required: ₹${finalPrice.toFixed(2)}. Please add funds.`,
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

    let provRes: any = null;
    try {
      provRes = await axios.post(apiUrl, params.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        },
        timeout: 35000
      });
    } catch (postErr: any) {
      // Fallback GET request if POST was rejected
      try {
        const sep = apiUrl.includes("?") ? "&" : "?";
        provRes = await axios.get(`${apiUrl}${sep}${params.toString()}`, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
          timeout: 35000
        });
      } catch (getErr: any) {
        provRes = postErr.response || getErr.response;
      }
    }

    let resData = provRes?.data;
    if (typeof resData === "string") {
      try { resData = JSON.parse(resData); } catch (e) {}
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
      if (finalPrice > 0) {
        newBal = Math.max(0, Number((currentUserBal - finalPrice).toFixed(2)));
      }
      const finalOrderId = orderId || `ord_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      const newOrderSummary = {
        id: finalOrderId,
        userId: finalUserId,
        userEmail: userEmail || orderData?.userEmail || "",
        serviceId: orderData?.serviceId || finalService,
        title: orderData?.title || "SMM Order",
        category: orderData?.category || "Other",
        quantity: Number(finalQty),
        targetLink: finalLink,
        totalPrice: finalPrice,
        status: "In progress",
        providerOrderId: finalOId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Update Turso database: deduct balance & record order
      try {
        const client = getTurso();
        if (client) {
          if (finalUserId) {
            await client.execute({
              sql: `UPDATE smm_users SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
              args: [newBal, finalUserId]
            });
          }

          // Save into smm_documents for users and orders
          if (finalUserId) {
            const updatedUser = {
              ...(existingUserDoc || {}),
              id: finalUserId,
              uid: finalUserId,
              balance: newBal,
              updatedAt: new Date().toISOString()
            };
            await client.execute({
              sql: `INSERT OR REPLACE INTO smm_documents (collection, id, data, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP);`,
              args: ["users", finalUserId, JSON.stringify(updatedUser)]
            });
          }

          await client.execute({
            sql: `INSERT OR REPLACE INTO smm_documents (collection, id, data, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP);`,
            args: ["orders", finalOrderId, JSON.stringify(newOrderSummary)]
          });
        }
      } catch (dbErr) {
        console.warn("[TURSO-ORDER-SYNC-WARN]", dbErr);
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
      let cleanErr = typeof errReason === "string" ? errReason : JSON.stringify(errReason);

      const lower = cleanErr.toLowerCase();
      if (lower.includes("current link already in work") || lower.includes("already in work") || lower.includes("already in progress")) {
        cleanErr = "Current link already in work! Please wait for the previous order on this link to finish, or use a different post link.";
      } else if (lower.includes("not enough balance") || lower.includes("low balance")) {
        cleanErr = "Provider panel has low balance. Please notify admin to recharge.";
      } else if (lower.includes("incorrect api key") || lower.includes("user disabled")) {
        cleanErr = "Provider API key configuration error. Please update provider settings in Admin.";
      }

      return res.status(200).json({
        success: false,
        error: cleanErr,
        currentBalance: currentUserBal,
        data: resData
      });
    }
  } catch (err: any) {
    const errorDetail = err.response?.data?.error || err.response?.data?.message || err.response?.data || err.message || "Failed to transmit order to provider";
    const cleanErr = typeof errorDetail === "string" ? errorDetail : JSON.stringify(errorDetail);

    return res.status(200).json({
      success: false,
      error: cleanErr
    });
  }
}
