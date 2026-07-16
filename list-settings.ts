import axios from "axios";
import * as fs from "fs";
import path from "path";

async function run() {
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const { projectId, apiKey } = config;
    const dbId = config.firestoreDatabaseId || "(default)";
    
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/settings?key=${apiKey}`;
    
    console.log("Listing all settings documents...");
    const res = await axios.get(url);
    const documents = res.data.documents || [];
    console.log(`Found ${documents.length} documents under settings:`);
    for (const doc of documents) {
      console.log(`- Document: ${doc.name.split("/").pop()}`);
      console.log("  Fields:", JSON.stringify(doc.fields, null, 2));
    }
  } catch (err: any) {
    console.error("FAIL:", err.response?.data || err.message);
  }
}

run();
