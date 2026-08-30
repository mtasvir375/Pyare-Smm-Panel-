import axios from "axios";

// Default known providers registry for instant zero-latency lookup
const KNOWN_PROVIDERS: Record<string, { apiUrl: string; apiKey: string; name: string }> = {
  "z9lfdj7ByNCeGNO6WbGZ": {
    name: "Smm bin",
    apiUrl: "https://smmbin.com/api/v2",
    apiKey: "f55bb2dfdc035f9c3c9e737bb72922a51d64309f"
  },
  "BjKqhBjQkzJ6y1GIYf5R": {
    name: "Wholesale smm store",
    apiUrl: "https://wholesalesmmstore.com/api/v2",
    apiKey: "68111b06da8d3f6d7281e2eb90317e33"
  },
  "k7IIPgA8QcpGmZGul3Pw": {
    name: "The main smm",
    apiUrl: "https://themainsmmprovider.com/api/v2",
    apiKey: "5053443feff7b12d7c5ee3a652613ba2"
  }
};

const DEFAULT_PROVIDER = {
  name: "Smm bin",
  apiUrl: "https://smmbin.com/api/v2",
  apiKey: "f55bb2dfdc035f9c3c9e737bb72922a51d64309f"
};

const FIREBASE_PROJECT_ID = "gen-lang-client-0629912823";
const FIREBASE_DATABASE_ID = "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";
const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY || "";

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
    const {
      userId,
      user_id: bodyUserId,
      userEmail,
      serviceId,
      service_id: bodyServiceId,
      courseId,
      title,
      category,
      quantity,
      targetLink,
      target_link: bodyTargetLink,
      totalPrice,
      orderId: passedOrderId,
      providerServiceId,
      provider_service_id: bodyProviderServiceId,
      providerId,
      provider_id: bodyProviderId,
      isCombo,
      comboItems
    } = req.body || {};

    const finalUserId = bodyUserId || userId || "";
    const finalServiceId = bodyServiceId || serviceId || courseId || "";
    const finalProviderServiceId = bodyProviderServiceId || providerServiceId || finalServiceId;
    const finalProviderId = bodyProviderId || providerId || "";
    const finalTargetLink = bodyTargetLink || targetLink || "";
    const finalQuantity = Math.floor(Number(quantity || 0));
    const finalTotalPrice = Number(totalPrice || 0);
    const orderId = passedOrderId || "ord_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);

    if (!finalTargetLink) {
      return res.status(400).json({ success: false, error: "Target link is required" });
    }
    if (!finalQuantity || finalQuantity < 1) {
      return res.status(400).json({ success: false, error: "Valid quantity is required" });
    }

    console.log(`[API-PROXY-PROVIDER] Dispatching order ${orderId} for user ${finalUserId} to provider ${finalProviderId} (service: ${finalProviderServiceId})`);

    // 1. Resolve Provider Details
    let provider = DEFAULT_PROVIDER;
    if (finalProviderId && KNOWN_PROVIDERS[finalProviderId]) {
      provider = KNOWN_PROVIDERS[finalProviderId];
    } else if (finalProviderId) {
      // Try to fetch custom provider from Firestore REST
      try {
        const pUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/providers/${finalProviderId}?key=${FIREBASE_API_KEY}`;
        const pRes = await axios.get(pUrl, { timeout: 4000 });
        if (pRes.data && pRes.data.fields) {
          const fields = pRes.data.fields;
          const pApiUrl = fields.apiUrl?.stringValue || fields.api_url?.stringValue;
          const pApiKey = fields.apiKey?.stringValue || fields.api_key?.stringValue;
          const pName = fields.name?.stringValue || "Custom Provider";
          if (pApiUrl && pApiKey) {
            provider = { name: pName, apiUrl: pApiUrl.trim(), apiKey: pApiKey.trim() };
          }
        }
      } catch (e) {
        console.warn("[API-PROXY-PROVIDER] Custom provider lookup failed, using default provider:", e);
      }
    }

    // 2. Dispatch to SMM Provider API
    let providerOrderId = "PENDING";
    let isSuccess = false;
    let providerErrorMessage = "";

    const comboList = Array.isArray(comboItems) && comboItems.length > 0 ? comboItems : null;

    if (isCombo && comboList) {
      // Combo service: dispatch all sub-services
      const results: any[] = [];
      for (const item of comboList) {
        const itemPServiceId = item.providerServiceId || item.serviceId || item.id;
        const itemPId = item.providerId || finalProviderId;
        const itemQty = Math.floor(finalQuantity * (Number(item.ratio || 1)));

        let itemProvider = provider;
        if (itemPId && KNOWN_PROVIDERS[itemPId]) {
          itemProvider = KNOWN_PROVIDERS[itemPId];
        }

        const params = new URLSearchParams();
        params.append("key", itemProvider.apiKey);
        params.append("action", "add");
        params.append("service", String(itemPServiceId).trim());
        params.append("link", String(finalTargetLink).trim());
        params.append("quantity", String(itemQty).trim());

        try {
          const pRes = await axios.post(itemProvider.apiUrl, params, {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            timeout: 20000
          });
          results.push(pRes.data);
        } catch (itemErr: any) {
          results.push({ error: itemErr.response?.data?.error || itemErr.message });
        }
      }

      const successfulItems = results.filter((r) => r && r.order);
      if (successfulItems.length > 0) {
        isSuccess = true;
        providerOrderId = successfulItems.map((r) => r.order).join(",");
      } else {
        providerErrorMessage = results.map((r) => r.error || "Failed").join("; ");
      }
    } else {
      // Single Service Dispatch
      const params = new URLSearchParams();
      params.append("key", provider.apiKey);
      params.append("action", "add");
      params.append("service", String(finalProviderServiceId).trim());
      params.append("link", String(finalTargetLink).trim());
      params.append("quantity", String(finalQuantity).trim());

      try {
        const pRes = await axios.post(provider.apiUrl, params, {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 25000
        });

        const data = pRes.data;
        if (data && (data.order || data.order_id || data.id)) {
          isSuccess = true;
          providerOrderId = String(data.order || data.order_id || data.id).trim();
        } else if (data && (data.error || data.message || data.msg)) {
          const rawE = data.error || data.message || data.msg;
          providerErrorMessage = typeof rawE === "string" ? rawE : JSON.stringify(rawE);
        } else {
          providerErrorMessage = "Invalid response from provider panel";
        }
      } catch (postErr: any) {
        const respData = postErr.response?.data;
        const errVal = respData?.error || respData?.message || respData?.msg || postErr.message;
        providerErrorMessage = typeof errVal === "string" ? errVal : JSON.stringify(errVal) || "Failed to reach provider server";
      }
    }

    // Format common provider error messages nicely
    if (providerErrorMessage) {
      const lower = providerErrorMessage.toLowerCase();
      if (lower.includes("current link already in work") || lower.includes("link already in work") || lower.includes("link is already in work") || lower.includes("link is already in progress")) {
        providerErrorMessage = "Current link already in work";
      } else if (lower.includes("not enough balance") || lower.includes("insufficient balance") || lower.includes("low balance")) {
        providerErrorMessage = "Provider panel has low balance. Please contact support.";
      } else if (lower.includes("service inactive") || lower.includes("service disabled")) {
        providerErrorMessage = "Service is currently inactive on provider panel.";
      } else if (lower.includes("bad link") || lower.includes("invalid link")) {
        providerErrorMessage = "Invalid link format. Please check your link.";
      }
    }

    // 3. Save Order to Firestore ONLY IF SUCCESSFUL (prevents ghost/failed order clutter)
    if (isSuccess) {
      const orderDoc = {
        id: orderId,
        userId: finalUserId,
        userEmail: userEmail || "",
        serviceId: finalServiceId,
        courseId: finalServiceId,
        title: title || "Service Order",
        category: category || "Other",
        quantity: finalQuantity,
        targetLink: finalTargetLink,
        totalPrice: finalTotalPrice,
        isCombo: !!isCombo,
        comboItems: comboList || [],
        status: "Pending",
        providerOrderId: providerOrderId,
        error: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      try {
        const authHeader = req.headers.authorization;
        const headers: any = { "Content-Type": "application/json" };
        if (authHeader) headers["Authorization"] = authHeader;

        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/orders/${orderId}?key=${FIREBASE_API_KEY}`;
        await axios.patch(firestoreUrl, { fields: wrapFirestoreFields(orderDoc) }, { headers, timeout: 5000 }).catch(() => {});
      } catch (dbErr) {
        console.warn("[API-PROXY-PROVIDER] Firestore order save non-critical warning:", dbErr);
      }

      return res.status(200).json({
        success: true,
        providerOrderId,
        orderId
      });
    } else {
      // Return 400 Bad Request with exact clean provider error without creating order or deducting balance
      return res.status(400).json({
        success: false,
        error: providerErrorMessage || "Order placement failed at provider",
        orderId
      });
    }

  } catch (err: any) {
    console.error("[API-PROXY-PROVIDER] Unexpected server exception:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error during order transmission"
    });
  }
}
