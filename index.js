require("dotenv").config();
const express = require("express");
const { createEventAdapter } = require("@slack/events-api");
const { WebClient } = require("@slack/web-api");
const axios = require("axios");

// Load env variables
const port = process.env.PORT || 3000;
const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
const slackToken = process.env.SLACK_BOT_TOKEN;
const apiKey = process.env.API_KEY;

// Create Slack Events adapter
const slackEvents = createEventAdapter(slackSigningSecret);

// Create a Slack WebClient (used to post messages, etc.)
const slackClient = new WebClient(slackToken);

// Translation function
async function translate(text, from, to) {
  const encodedParams = new URLSearchParams();
  encodedParams.append("q", text);
  encodedParams.append("target", to);
  encodedParams.append("source", from);

  const options = {
    method: "POST",
    url: "https://google-translate1.p.rapidapi.com/language/translate/v2",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "Accept-Encoding": "application/gzip",
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": "google-translate1.p.rapidapi.com",
    },
    data: encodedParams,
  };

  try {
    const response = await axios.request(options);
    return response.data.data.translations[0].translatedText;
  } catch (error) {
    console.error("Translation error:", error);
    return null;
  }
}

// Handle "message" events
slackEvents.on("message", async (event) => {
  console.log("Received a message event:", event);

  // Ignore bot messages
  if (event.bot_id) return;

  try {
    const mess = event.text;
    const textEn = await translate(mess, "ja", "en");
    const textVi = await translate(mess, "ja", "vi");

    await slackClient.chat.postMessage({
      channel: event.channel,
      text: `:flag-gb: ${textEn} \n:flag-vn: ${textVi}`,
      thread_ts: event.event_ts,
    });
  } catch (error) {
    console.error("Error handling message event:", error);
  }
});

// Log any errors from the Slack adapter
slackEvents.on("error", console.error);

// ====================
// CREATE EXPRESS APP
// ====================
const app = express();;

// Define a root route to return "Server is running"
app.get("/check", (req, res) => {
  res.send("Server is running");
});

// Start the Express server
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
  console.log("Slack Bot is ready to receive events!");
});
