import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import * as fs from "fs";
import path from "path";

async function run() {
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const { firestoreDatabaseId } = config;
    const dbId = firestoreDatabaseId || "(default)";

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault()
      });
    }

    const fdb = getFirestore(admin.apps[0] || admin.app(), dbId);

    console.log("Testing Admin SDK fetch of settings/payment...");
    const paymentDoc = await fdb.collection("settings").doc("payment").get();
    console.log("Admin SDK settings/payment fetch SUCCESS. Exists:", paymentDoc.exists);

    console.log("Testing Admin SDK fetch of providers...");
    const snap = await fdb.collection("providers").get();
    console.log(`Admin SDK providers fetch SUCCESS. Found ${snap.size} documents.`);
    
    snap.forEach(doc => {
      console.log(`ID: ${doc.id}, Data:`, doc.data());
    });

  } catch (err: any) {
    console.error("Admin SDK test FAILED:", err.message);
  }
}

run();
