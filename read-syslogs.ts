import axios from "axios";
import * as fs from "fs";
import path from "path";

async function run() {
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const { projectId, apiKey } = config;
    const dbId = config.firestoreDatabaseId || "(default)";
    
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents:runQuery?key=${apiKey}`;
    
    // Query orders collection for syslogs
    const query = {
      structuredQuery: {
        from: [{ collectionId: "orders" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "isSyslog" },
            op: "EQUAL",
            value: { booleanValue: true }
          }
        },
        orderBy: [{
          field: { fieldPath: "timestamp" },
          direction: "DESCENDING"
        }],
        limit: 15
      }
    };
    
    console.log(`Fetching last 15 system logs from orders collection...`);
    const res = await axios.post(url, query, { timeout: 10000 });
    
    const results = res.data;
    if (!results || !Array.isArray(results) || results.length === 0 || !results[0].document) {
      console.log("No system logs found.");
      return;
    }
    
    for (const item of results) {
      if (item.document) {
        const doc = item.document;
        const nameParts = doc.name.split("/");
        const docId = nameParts[nameParts.length - 1];
        const fields = doc.fields || {};
        
        console.log(`\n----------------------------------------`);
        console.log(`[SYSLOG] ${docId}`);
        console.log(`EVENT: ${fields.event?.stringValue}`);
        console.log(`TIME : ${fields.timestamp?.timestampValue}`);
        console.log(`ENV  : ${fields.env?.stringValue}`);
        console.log(`META : ${fields.meta?.stringValue}`);
        console.log(`----------------------------------------`);
      }
    }
  } catch (err: any) {
    console.error("FAIL:", err.response?.data || err.message);
  }
}

run();
