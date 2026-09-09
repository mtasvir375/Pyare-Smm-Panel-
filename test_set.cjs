const axios = require("axios");
const config = require("./firebase-applet-config.json");
const url = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/users/c4w6bjFk9leTy9SR2ijM0YyJVfx1?key=${config.apiKey}&updateMask.fieldPaths=balance&updateMask.fieldPaths=updatedAt`;
axios.patch(url, { fields: { balance: { doubleValue: 20 }, updatedAt: { stringValue: new Date().toISOString() } } })
  .then(r => console.log("OK PATCH", r.data.fields.balance))
  .catch(e => console.error("ERR", e.response?.data || e.message));
