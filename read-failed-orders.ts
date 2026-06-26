import axios from "axios";
import fs from "fs";
import path from "path";

function unwrapRestFields(fields: any) {
  const result: any = {};
  for (const key in fields) {
    const val = fields[key];
    if (!val) continue;
    if (val.stringValue !== undefined) result[key] = val.stringValue;
    else if (val.integerValue !== undefined) result[key] = parseInt(val.integerValue);
    else if (val.doubleValue !== undefined) result[key] = parseFloat(val.doubleValue);
    else if (val.booleanValue !== undefined) result[key] = val.booleanValue;
    else if (val.timestampValue !== undefined) result[key] = val.timestampValue;
    else if (val.mapValue !== undefined) result[key] = unwrapRestFields(val.mapValue.fields || {});
  }
  return result;
}

async function getAccessToken() {
  try {
    const res = await axios.get(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      {
        headers: { "Metadata-Flavor": "Google" },
        timeout: 5000
      }
    );
    return res.data.access_token;
  } catch (err: any) {
    console.warn("Could not get access token from metadata server:", err.message);
    return null;
  }
}

async function run() {
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const { projectId } = config;
    const dbId = "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";

    const token = await getAccessToken();
    const headers: any = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
      console.log("Using authenticated GCP Service Account token for Firestore access.");
    }

    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/orders?pageSize=100`;
    console.log("Fetching orders...");
    const res = await axios.get(url, { headers });
    const documents = res.data.documents || [];
    console.log(`Found ${documents.length} orders.`);
    
    // Sort manually in memory by creation time
    const sortedDocs = documents.map((doc: any) => ({
      id: doc.name.split("/").pop(),
      fields: unwrapRestFields(doc.fields || {}),
      createTime: doc.createTime
    })).sort((a: any, b: any) => new Date(b.fields.createdAt || b.createTime).getTime() - new Date(a.fields.createdAt || a.createTime).getTime());

    for (const doc of sortedDocs.slice(0, 30)) {
      console.log(`\nOrder ID: ${doc.id}`);
      console.log(`- Course/Service: ${doc.fields.courseTitle || doc.fields.title}`);
      console.log(`- User ID: ${doc.fields.userId}`);
      console.log(`- User Email: ${doc.fields.userEmail}`);
      console.log(`- Status: ${doc.fields.status}`);
      console.log(`- Provider ID: ${doc.fields.providerId}`);
      console.log(`- Provider Transmission Status: ${doc.fields.providerTransmissionStatus}`);
      console.log(`- Provider Order ID: ${doc.fields.providerOrderId || "N/A"}`);
      console.log(`- Error: ${doc.fields.error || "None"}`);
      console.log(`- Total Price: ₹${doc.fields.totalPrice}`);
      console.log(`- Target Link: ${doc.fields.targetLink}`);
      console.log(`- Created At: ${doc.fields.createdAt}`);
    }
  } catch (err: any) {
    console.error("FAILED to fetch orders:", err.response?.data || err.message);
  }
}

run();
