const axios = require("axios");

axios.post("http://localhost:3000/api/proxy-provider", {
  userId: "c4w6bjFk9leTy9SR2ijM0YyJVfx1",
  serviceId: "C2nVgAQWtrH130AoU03J",
  totalPrice: 9.9,
  quantity: 100,
  link: "https://example.com"
}).then(r => console.log(r.data)).catch(e => console.error(e.response.data));
