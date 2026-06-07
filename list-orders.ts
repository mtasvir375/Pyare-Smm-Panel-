import axios from "axios";
import * as fs from "fs";
import path from "path";

async function run() {
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const { projectId, apiKey } = config;
    const dbId = config.firestoreDatabaseId || "(default)";
    
    // Let's call StructuredQuery via runQuery to fetch the last 10 orders sorted by createdAt desc
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents:runQuery?key=${apiKey}`;
    
    const query = {
      structuredQuery: {
        from: [{ collectionId: "orders" }],
        orderBy: [{
          field: { fieldPath: "createdAt" },
          direction: "DESCENDING"
        }],
        limit: 10
      }
    };
    
    console.log(`Calling REST runQuery to fetch last 10 orders...`);
    const res = await axios.post(url, query, { timeout: 10000 });
    
    const results = res.data;
    if (!results || !Array.isArray(results) || results.length === 0 || !results[0].document) {
      console.log("No orders found in db or empty results.");
      console.log("Results payload:", JSON.stringify(results, null, 2));
      return;
    }
    
    for (const item of results) {
      if (item.document) {
        const doc = item.document;
        const nameParts = doc.name.split("/");
        const docId = nameParts[nameParts.length - 1];
        const fields = doc.fields || {};
        
        console.log(`\n========================================`);
        console.log(`ORDER ID: ${docId}`);
        console.log(`Course / Service ID: ${fields.courseId?.stringValue}`);
        console.log(`Target Link: ${fields.targetLink?.stringValue}`);
        console.log(`Quantity: ${fields.quantity?.integerValue || fields.quantity?.doubleValue || fields.quantity?.stringValue}`);
        console.log(`Status: ${fields.status?.stringValue}`);
        console.log(`Error: ${fields.error?.stringValue}`);
        console.log(`Provider Order ID: ${fields.providerOrderId?.stringValue}`);
        console.log(`Provider Raw Response: ${fields.providerRawResponse?.stringValue}`);
        console.log(`Created At: ${fields.createdAt?.timestampValue}`);
        console.log(`User ID: ${fields.userId?.stringValue}`);
        console.log(`========================================`);
      }
    }
  } catch (err: any) {
    console.error("REST CALL ERROR:", err.response?.data || err.message);
  }
}

run();
