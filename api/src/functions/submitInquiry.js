const { app } = require("@azure/functions");
const { handleInquiry } = require("../inquiry");

// All of the logic lives in ../inquiry.js so it can be unit tested without
// the Azure Functions host.
app.http("submitInquiry", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "submit-inquiry",
  handler: handleInquiry,
});
