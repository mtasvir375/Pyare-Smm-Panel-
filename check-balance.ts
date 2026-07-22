import axios from "axios";
import * as fs from "fs";
import * as path from "path";

// Helper to unwrap REST fields
function unwrapRestFields(fields: any): any {
  const result: any = {};
  if (!fields) return result;
  for (const key in fields) {
    const val = fields[key];
    if (!val) continue;
    if (val.stringValue !== undefined) result[key] = val.stringValue;
    else if (val.integerValue !== undefined) result[key] = parseInt(val.integerValue, 10);
    else if (val.doubleValue !== undefined) result[key] = parseFloat(val.doubleValue);
    else if (val.booleanValue !== undefined) result[key] = val.booleanValue;
    else if (val.timestampValue !== undefined) result[key] = val.timestampValue;
    else if (val.arrayValue !== undefined) {
      const vals = val.arrayValue.values || [];
      result[key] = vals.map((v: any) => {
        if (v.stringValue !== undefined) return v.stringValue;
        if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
        if (v.doubleValue !== undefined) return parseFloat(v.doubleValue);
        if (v.booleanValue !== undefined) return v.booleanValue;
        return null;
      });
    } else if (val.mapValue !== undefined) {
      result[key] = unwrapRestFields(val.mapValue.fields || {});
    }
  }
  return result;
}

async function getAccessToken() {
  try {
    const res = await axios.get(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      { headers: { "Metadata-Flavor": "Google" }, timeout: 2000 }
    );
    if (res.data?.access_token) {
      return res.data.access_token;
    }
    return null;
  } catch (err: any) {
    console.warn("Failed to get metadata token:", err.message);
    return null;
  }
}

async function main() {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const { projectId, apiKey, firestoreDatabaseId: dbId } = firebaseConfig;

  console.log("Config Details:", { projectId, dbId });

  const token = await getAccessToken();
  const headers: any = {};
  if (token) {
    console.log("Acquired system access token successfully!");
    headers["Authorization"] = `Bearer ${token}`;
  } else {
    console.log("No token acquired, calling unauthenticated.");
  }

  // List all users
  const listUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/users?key=${apiKey}&pageSize=300`;
  try {
    const response = await axios.get(listUrl, { headers });
    const docs = response.data.documents || [];
    console.log(`Found ${docs.length} users overall in 'users' collection.`);
    
    let targetUserFound = false;
    for (const doc of docs) {
      const id = doc.name.split("/").pop();
      const fields = unwrapRestFields(doc.fields || {});
      if (fields.email === "mtasvir375@gmail.com") {
        targetUserFound = true;
        console.log("\n=== TARGET USER PROFILE ===");
        console.log(`ID: ${id}`);
        console.log("Data:", JSON.stringify(fields, null, 2));
      } else if (fields.balance > 10 || fields.role === 'admin') {
        console.log(`User ID: ${id}, Email: ${fields.email}, Balance: ${fields.balance}, Role: ${fields.role}`);
      }
    }

    if (!targetUserFound) {
      console.log("\nWARNING: No user with email 'mtasvir375@gmail.com' found in users list.");
    }

    // Also look for deposits for this email/userId or logs
    console.log("\nChecking recent deposits...");
    const depUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/deposits?key=${apiKey}&pageSize=50`;
    const depResponse = await axios.get(depUrl, { headers });
    const depDocs = depResponse.data.documents || [];
    for (const doc of depDocs) {
      const fields = unwrapRestFields(doc.fields || {});
      if (fields.email === "mtasvir375@gmail.com" || fields.userEmail === "mtasvir375@gmail.com") {
        console.log("Deposit doc:", JSON.stringify(fields, null, 2));
      }
    }

    // Also check logs
    console.log("\nChecking recent logs...");
    const logUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/logs?key=${apiKey}&pageSize=50`;
    const logResponse = await axios.get(logUrl, { headers });
    const logDocs = logResponse.data.documents || [];
    for (const doc of logDocs) {
      const fields = unwrapRestFields(doc.fields || {});
      if (fields.userId === "mtasvir375@gmail.com" || JSON.stringify(fields).includes("mtasvir375")) {
        console.log("Log doc:", JSON.stringify(fields, null, 2));
      }
    }

  } catch (err: any) {
    console.error("Failed to fetch users list via REST:", err.response?.data || err.message);
  }
}

main().catch(console.error);
