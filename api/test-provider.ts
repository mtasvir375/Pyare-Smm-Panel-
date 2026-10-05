import axios from "axios";
import { createClient } from "@libsql/client/web";

const TURSO_URL = process.env.TURSO_DATABASE_URL || process.env.TURSO_URL || "libsql://pyare-smm-panel-pyaresmmpanel.aws-ap-south-1.turso.io";
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || process.env.TURSO_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTEwNjQ0NzgsImlkIjoiMDFhMTAzYzEtNzYwMS03NDk5LTljYWMtYzdkMDExOWU5M2ZkIiwia2lkIjoiYVFCV3BPanpQSVA2czQzcGlrZ29pbkJtVlNodDZOTmh0YndUejBpaDRGOCIsInJpZCI6IjM0MTg2ZDIxLTgwYTUtNDU1YS1hOWQ3LWJhNGQzZTJlNTIzYSJ9.MXelOKfVsMZZoYfKiflhegiqqXQD5-0HN_faUU4z7WtQdjiQQTWXpU-i8jF1DiQrRpFUUV5wol-7dikl8pW5Dw";

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

    const { providerId, providerApiUrl, providerApiKey } = body;
    let pUrl = String(providerApiUrl || body?.apiUrl || "").trim();
    let pKey = String(providerApiKey || body?.apiKey || "").trim();
    const pId = String(providerId || "").trim();

    // 1. Resolve from known providers
    if ((!pUrl || !pKey) && pId && KNOWN_PROVIDERS[pId]) {
      if (!pUrl) pUrl = KNOWN_PROVIDERS[pId].apiUrl;
      if (!pKey) pKey = KNOWN_PROVIDERS[pId].apiKey;
    }

    // 2. Resolve from Turso database
    if ((!pUrl || !pKey) && pId) {
      try {
        const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
        const pRes = await client.execute({
          sql: `SELECT api_url, api_key FROM smm_providers WHERE id = ? LIMIT 1;`,
          args: [pId]
        });
        if (pRes.rows.length > 0) {
          if (!pUrl) pUrl = String(pRes.rows[0].api_url || "").trim();
          if (!pKey) pKey = String(pRes.rows[0].api_key || "").trim();
        }
      } catch (tErr) {}
    }

    // 3. Fallback defaults
    if (!pUrl) pUrl = "https://www.smmbin.com/api/v2";
    if (!pKey) pKey = "f55bb2dfdc035f9c3c9e737bb72922a51d64309f";

    if (!pUrl.startsWith("http")) pUrl = "https://" + pUrl;

    const params = new URLSearchParams();
    params.append("key", pKey);
    params.append("action", "balance");

    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    };

    let provRes: any = null;
    try {
      provRes = await axios.post(pUrl, params.toString(), { headers, timeout: 15000 });
    } catch (postErr: any) {
      const sep = pUrl.includes("?") ? "&" : "?";
      provRes = await axios.get(`${pUrl}${sep}${params.toString()}`, { headers, timeout: 15000 });
    }

    let resData = provRes?.data;
    if (typeof resData === "string") {
      try { resData = JSON.parse(resData); } catch (e) {}
    }

    if (resData && resData.balance !== undefined) {
      const numBal = Number(resData.balance);
      // Update Turso provider balance asynchronously
      if (pId) {
        try {
          const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
          await client.execute({
            sql: `UPDATE smm_providers SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
            args: [numBal, pId]
          });
        } catch (updErr) {}
      }
      return res.status(200).json({ success: true, balance: resData.balance, currency: resData.currency || "INR" });
    } else if (resData && resData.error) {
      const errMsg = typeof resData.error === "string" ? resData.error : JSON.stringify(resData.error);
      return res.status(400).json({ success: false, error: errMsg });
    } else {
      return res.status(200).json({ success: true, balance: "0.00", currency: "INR", data: resData });
    }
  } catch (err: any) {
    const errorDetail = err.response?.data?.error || err.response?.data?.message || err.response?.data || err.message || "Failed to reach provider";
    const cleanErr = typeof errorDetail === "string" ? errorDetail : JSON.stringify(errorDetail);
    return res.status(200).json({ success: false, error: cleanErr });
  }
}
