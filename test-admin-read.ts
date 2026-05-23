import { initializeApp, getApps, getApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as fs from "fs";
import path from "path";

async function test() {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  
  const app = getApps().length === 0 ? initializeApp({
    credential: applicationDefault(),
    projectId: firebaseConfig.projectId,
  }) : getApp();
  
  const dbId = firebaseConfig.firestoreDatabaseId || "(default)";
  const db = getFirestore(app, dbId);
  
  try {
    const res = await db.collection("users").limit(1).get();
    console.log("Success:", res.docs.length);
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
