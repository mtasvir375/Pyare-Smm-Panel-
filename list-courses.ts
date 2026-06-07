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
    
    // Query courses collection via runQuery
    const query = {
      structuredQuery: {
        from: [{ collectionId: "courses" }],
        limit: 15
      }
    };
    
    console.log(`Fetching courses via runQuery...`);
    const res = await axios.post(url, query, { timeout: 10000 });
    
    const results = res.data;
    if (!results || !Array.isArray(results) || results.length === 0 || !results[0].document) {
      console.log("No courses found.");
      return;
    }
    
    for (const item of results) {
      if (item.document) {
        const doc = item.document;
        const nameParts = doc.name.split("/");
        const docId = nameParts[nameParts.length - 1];
        const fields = doc.fields || {};
        
        console.log(`\n----------------------------------------`);
        console.log(`ID                  : ${docId}`);
        console.log(`Title               : ${fields.title?.stringValue}`);
        console.log(`Price Per Thousand  : ${fields.pricePerThousand?.doubleValue || fields.pricePerThousand?.integerValue}`);
        console.log(`ProviderServiceId   : ${fields.providerServiceId?.stringValue}`);
        console.log(`MinLimit            : ${fields.minLimit?.integerValue || fields.minLimit?.doubleValue}`);
        console.log(`Status              : ${fields.status?.stringValue}`);
        console.log(`----------------------------------------`);
      }
    }
  } catch (err: any) {
    console.error("FAIL:", err.response?.data || err.message);
  }
}

run();
