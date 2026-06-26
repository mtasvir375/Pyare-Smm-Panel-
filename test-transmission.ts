import axios from "axios";
import * as fs from "fs";
import * as path from "path";

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
  const databaseId = "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";

  console.log("Using projectId:", projectId, "databaseId:", databaseId);

  const getRestDoc = async (col: string, id: string) => {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/${col}/${id}?key=${FIREBASE_API_KEY}`;
    try {
      const res = await axios.get(url, { timeout: 10000 });
      return { exists: true, data: unwrapRestFields(res.data.fields || {}) };
    } catch (err: any) {
      console.error(`REST Error getting ${col}/${id}:`, err.response?.data || err.message);
      return { exists: false, data: {} };
    }
  };

  // Let's test with course EUEsSLoKiJziaepvTUpw (Like (Lifetime ♻️)) which uses provider LaP7jScfwUOTFipQNfXf (Smm bin)
  const courseId = "EUEsSLoKiJziaepvTUpw";
  console.log(`\nFetching course ${courseId} via REST...`);
  const courseObj = await getRestDoc("courses", courseId);
  if (!courseObj.exists) {
    console.log("Course not found!");
    return;
  }
  console.log("Course Title:", courseObj.data.title);
  console.log("Provider ID:", courseObj.data.providerId);
  console.log("Provider Service ID:", courseObj.data.providerServiceId || courseObj.data.provider_service_id);

  let pUrl = "";
  let pKey = "";

  if (courseObj.data.providerId && courseObj.data.providerId !== "global") {
    console.log(`Course uses custom provider: ${courseObj.data.providerId}`);
    const provObj = await getRestDoc("providers", courseObj.data.providerId);
    if (provObj.exists) {
      pUrl = (provObj.data.apiUrl || provObj.data.api_url || "").trim();
      pKey = (provObj.data.apiKey || provObj.data.api_key || "").trim();
    }
  }

  console.log("Resolved SMM Panel URL:", pUrl);
  console.log("Resolved SMM Panel Key Length:", pKey.length);

  if (!pUrl || !pKey) {
    console.error("Provider details missing!");
    return;
  }

  try {
    const balParams = new URLSearchParams();
    balParams.append("key", pKey);
    balParams.append("action", "balance");
    console.log("\nChecking balance of panel via URLSearchParams...");
    const balRes = await axios.post(pUrl, balParams.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000
    });
    console.log("SMM Panel Balance Response:", balRes.data);
  } catch (err: any) {
    console.error("Balance inquiry failed:", err.message, err.response ? err.response.data : "");
  }
}

run();
