const axios = require("axios");
const config = require("./firebase-applet-config.json");
const url = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/users/c4w6bjFk9leTy9SR2ijM0YyJVfx1?key=${config.apiKey}`;
axios.get(url).then(r => console.log("OK GET", r.data.fields.balance)).catch(e => console.error("ERR", e.response?.data || e.message));
