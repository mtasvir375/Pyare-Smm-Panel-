const axios = require("axios");
const config = require("./firebase-applet-config.json");
const url = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/users/c4w6bjFk9leTy9SR2ijM0YyJVfx1?key=${config.apiKey}&updateMask.fieldPaths=balance`;
axios.patch(url, { fields: { balance: { doubleValue: 19 } } })
  .then(r => console.log("OK PATCH NO HEADER", r.data.fields.balance))
  .catch(e => console.error("ERR NO HEADER", e.response?.data || e.message));
