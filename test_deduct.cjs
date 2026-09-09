const axios = require("axios");
const config = require("./firebase-applet-config.json");
const url = `http://localhost:3000/api/test-firebase`;
axios.get(url).then(r => console.log(r.data)).catch(console.error);
