import admin from "firebase-admin";
admin.initializeApp({ projectId: "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c" });
const db = admin.firestore();

async function run() {
  const settings = await db.collection("settings").doc("payment").get();
  console.log("Settings in DB:");
  console.log(settings.data());
}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
