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
    else if (val.timestampValue !== undefined) result[key] = val.booleanValue; // Boolean handling
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
    return null;
  }
}

async function run() {
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const { projectId, apiKey } = config;
    const dbId = "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";

    const token = await getAccessToken();
    const headers: any = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/orders?pageSize=10&key=${apiKey}`;
    const res = await axios.get(url, { headers });
    const documents = res.data.documents || [];
    
    console.log(`Checking last ${documents.length} orders...\n`);

    const orders = documents.map((doc: any) => {
      const data = unwrapRestFields(doc.fields || {});
      return {
        id: doc.name.split("/").pop(),
        ...data,
        createTime: doc.createTime
      };
    }).sort((a: any, b: any) => new Date(b.createdAt || b.createTime).getTime() - new Date(a.createdAt || a.createTime).getTime());

    for (const o of orders) {
      console.log(`Order: ${o.id}`);
      console.log(`- Service: ${o.title}`);
      console.log(`- Provider ID: ${o.providerId}`);
      console.log(`- Provider Transmission: ${o.providerTransmissionStatus}`);
      console.log(`- Provider Order ID: ${o.providerOrderId}`);
      console.log(`- Status: ${o.status}`);
      console.log(`- Created At: ${o.createdAt || o.createTime}`);
      console.log(`- Error: ${o.error || "N/A"}`);
      console.log("-------------------");
    }
  } catch (err: any) {
    console.error("Error:", err.response?.data || err.message);
  }
}

run();
