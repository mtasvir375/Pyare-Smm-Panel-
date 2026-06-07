import axios from "axios";
import * as fs from "fs";
import path from "path";

async function run() {
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const { projectId, apiKey } = config;
    const dbId = config.firestoreDatabaseId || "(default)";
    
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/settings/payment?key=${apiKey}`;
    
    console.log("Fetching settings/payment from Firestore...");
    const res = await axios.get(url);
    const fields = res.data.fields || {};
    
    console.log("\nSETTINGS VALUES:");
    console.log(`providerApiUrl: ${fields.providerApiUrl?.stringValue}`);
    console.log(`providerApiKey: ${fields.providerApiKey?.stringValue ? "SET (length: " + fields.providerApiKey.stringValue.length + ")" : "NOT SET"}`);
    console.log(`backendApiUrl : ${fields.backendApiUrl?.stringValue}`);
  } catch (err: any) {
    console.error("FAIL:", err.response?.data || err.message);
  }
}

run();
