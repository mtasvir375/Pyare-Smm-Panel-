import axios from "axios";
import * as fs from "fs";
import * as path from "path";

// Unwrapping Firestore REST fields
const unwrapRestFields = (fields: any) => {
  const result: any = {};
  for (const key in fields) {
    const val = fields[key];
    if (val.stringValue !== undefined) result[key] = val.stringValue;
    else if (val.doubleValue !== undefined) result[key] = Number(val.doubleValue);
    else if (val.integerValue !== undefined) result[key] = Number(val.integerValue);
    else if (val.timestampValue !== undefined) result[key] = val.timestampValue;
    else if (val.booleanValue !== undefined) result[key] = val.booleanValue;
    else if (val.mapValue !== undefined) result[key] = unwrapRestFields(val.mapValue.fields || {});
  }
  return result;
};

async function run() {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const { projectId, apiKey: FIREBASE_API_KEY } = firebaseConfig;
  const databaseId = (firebaseConfig.firestoreDatabaseId || "").trim() || "(default)";

  console.log("Using projectId:", projectId, "databaseId:", databaseId);

  const getRestDoc = async (col: string, id: string) => {
    const tidyDb = (!databaseId || databaseId === "(default)") ? "(default)" : databaseId;
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${tidyDb}/documents/${col}/${id}?key=${FIREBASE_API_KEY}`;
    try {
      const res = await axios.get(url, { timeout: 10000 });
      return { exists: true, data: unwrapRestFields(res.data.fields || {}) };
    } catch (err: any) {
      console.error(`REST Error getting ${col}/${id}:`, err.message);
      return { exists: false, data: {} };
    }
  };

  const orderId = "Oz0CJcJQLy5zx5U0HRvS";
  console.log(`Fetching order ${orderId} via REST...`);
  const orderObj = await getRestDoc("orders", orderId);
  if (!orderObj.exists) {
    console.log("Order not found via REST!");
    return;
  }
  console.log("Order Data:", JSON.stringify(orderObj.data, null, 2));

  const courseId = orderObj.data.courseId;
  console.log(`Fetching course ${courseId} via REST...`);
  const courseObj = await getRestDoc("courses", courseId);
  if (!courseObj.exists) {
    console.log("Course not found via REST!");
    return;
  }
  console.log("Course Data:", JSON.stringify(courseObj.data, null, 2));

  // Settings
  console.log("Fetching settings/payment via REST...");
  const settingsObj = await getRestDoc("settings", "payment");
  const settingsData = settingsObj.data;
  console.log("Settings Data:", JSON.stringify(settingsData, null, 2));

  let pUrl = (settingsData.providerApiUrl || "").trim();
  let pKey = (settingsData.providerApiKey || "").trim();

  if (courseObj.data.providerId && courseObj.data.providerId !== "global") {
    console.log(`Course uses custom provider: ${courseObj.data.providerId}`);
    const provObj = await getRestDoc("providers", courseObj.data.providerId);
    if (provObj.exists) {
      pUrl = (provObj.data.apiUrl || "").trim();
      pKey = (provObj.data.apiKey || "").trim();
    }
  }

  console.log("Resolved SMM Panel URL:", pUrl);
  console.log("Resolved SMM Panel Key Length:", pKey.length);

  try {
    const balParams = new URLSearchParams();
    balParams.append("key", pKey);
    balParams.append("action", "balance");
    console.log("Checking balance of panel...");
    const balRes = await axios.post(pUrl, balParams.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000
    });
    console.log("SMM Panel Balance Response:", balRes.data);
  } catch (err: any) {
    console.error("Balance inquiry failed:", err.message, err.response ? err.response.data : "");
  }

  try {
    const orderParams = new URLSearchParams();
    orderParams.append("key", pKey);
    orderParams.append("action", "add");
    orderParams.append("service", String(courseObj.data.providerServiceId));
    orderParams.append("link", String(orderObj.data.targetLink));
    orderParams.append("quantity", String(orderObj.data.quantity));

    console.log("Submitting order to provider...", orderParams.toString());
    const addRes = await axios.post(pUrl, orderParams.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 12000
    });
    console.log("SMM Panel Add Order Response:", addRes.data);
  } catch (err: any) {
    console.error("Order submit failed:", err.message, err.response ? err.response.data : "");
  }
}

run();
