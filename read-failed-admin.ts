import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";

async function run() {
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const { projectId } = config;
    const dbId = config.firestoreDatabaseId || "(default)";

    if (!getApps().length) {
      initializeApp({ projectId });
    }

    const targetDb = (!dbId || dbId === "(default)") ? undefined : dbId;
    const db = getFirestore(targetDb);

    console.log(`Querying last 15 orders from DB: ${dbId}...`);
    const snap = await db.collection("orders")
      .orderBy("createdAt", "desc")
      .limit(15)
      .get();

    console.log(`Found ${snap.size} orders:`);

    snap.forEach((doc: any) => {
      const data = doc.data();
      const createdAtDate = data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt)) : null;
      console.log(`\nOrder ID: ${doc.id}`);
      console.log(`- Course/Service: ${data.courseTitle}`);
      console.log(`- Status: ${data.status}`);
      console.log(`- Provider Transmission Status: ${data.providerTransmissionStatus}`);
      console.log(`- Provider Order ID: ${data.providerOrderId || "N/A"}`);
      console.log(`- Error: ${data.error || "None"}`);
      console.log(`- Total Price: ₹${data.totalPrice}`);
      console.log(`- Target Link: ${data.targetLink}`);
      console.log(`- Created At: ${createdAtDate ? createdAtDate.toISOString() : "N/A"}`);
    });
  } catch (err: any) {
    console.error("ADMIN FETCH FAILED:", err.message);
  }
}

run();
