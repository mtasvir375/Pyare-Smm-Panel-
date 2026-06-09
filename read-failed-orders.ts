import axios from "axios";
import fs from "fs";
import path from "path";

function unwrapRestFields(fields: any) {
  const result: any = {};
  for (const key in fields) {
    const val = fields[key];
    if (val.stringValue !== undefined) result[key] = val.stringValue;
    else if (val.integerValue !== undefined) result[key] = parseInt(val.integerValue);
    else if (val.doubleValue !== undefined) result[key] = parseFloat(val.doubleValue);
    else if (val.booleanValue !== undefined) result[key] = val.booleanValue;
    else if (val.timestampValue !== undefined) result[key] = val.timestampValue;
    else if (val.mapValue !== undefined) result[key] = unwrapRestFields(val.mapValue.fields || {});
  }
  return result;
}

async function run() {
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const { projectId, apiKey } = config;
    const dbId = config.firestoreDatabaseId || "(default)";

    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/orders?key=${apiKey}&pageSize=50`;
    console.log("Fetching orders...");
    const res = await axios.get(url);
    const documents = res.data.documents || [];
    console.log(`Found ${documents.length} orders.`);
    
    // Sort manually in memory
    const sortedDocs = documents.map((doc: any) => ({
      id: doc.name.split("/").pop(),
      fields: unwrapRestFields(doc.fields || {}),
      createTime: doc.createTime
    })).sort((a: any, b: any) => new Date(b.fields.createdAt || b.createTime).getTime() - new Date(a.fields.createdAt || a.createTime).getTime());

    for (const doc of sortedDocs.slice(0, 15)) {
      console.log(`\nOrder ID: ${doc.id}`);
      console.log(`- Course/Service: ${doc.fields.courseTitle}`);
      console.log(`- Status: ${doc.fields.status}`);
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
