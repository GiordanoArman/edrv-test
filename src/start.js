console.log("starting...");
require("./index.js")({
  url: "https://my.newmotion.com/api/map/v2/locations/2735712"
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
