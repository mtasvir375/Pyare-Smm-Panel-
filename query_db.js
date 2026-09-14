const admin = require("firebase-admin");
const serviceAccount = require("./firebase-applet-config.json");
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
  const settings = await db.collection("settings").doc("payment").get();
  console.log("Settings:");
  console.log(settings.data());
}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
