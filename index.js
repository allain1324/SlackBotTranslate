require("dotenv").config();
const express = require("express");
const { createEventAdapter } = require("@slack/events-api");
const { WebClient } = require("@slack/web-api");
const langdetect = require("langdetect");
const OpenAI = require("openai");

// Load env variables
const port = process.env.PORT || 3000;
const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
const slackToken = process.env.SLACK_BOT_TOKEN;
const apiKey = process.env.API_KEY;
const gptUrl = process.env.BASE_GPT_URL;
const nameModel = process.env.NAME_MODEL;

// Create Slack Events adapter
const slackEvents = createEventAdapter(slackSigningSecret);

// Create a Slack WebClient (used to post messages, etc.)
const slackClient = new WebClient(slackToken);

// Initialize OpenAI with Qwen
const openai = new OpenAI({
  apiKey: apiKey, // Use Alibaba's DashScope API key
  baseURL: gptUrl,
});

function removeQuotes(text) {
  // Sử dụng regex để xóa các ký tự ở đầu và cuối chuỗi
  return text.replace(/^["「]|["」]$/g, "");
}

function detectLanguage(text) {
  const detected = langdetect.detect(text);
  if (detected.length > 0) {
    return detected[0].lang; // 'vi', 'ja', 'en', ...
  }
  return "und";
}

function parseSlackMessage(message) {
  // Regex to match user IDs
  const userIdRegex = /<@([A-Z0-9]+)>/g;

  // Extract user IDs
  let userIds = [];
  let match;
  while ((match = userIdRegex.exec(message)) !== null) {
    userIds.push(match[1]);
  }

  // Remove user tags from message content
  let cleanContent = message.replace(userIdRegex, "").trim();

  return {
    userIDTagged: userIds,
    content: cleanContent,
  };
}

// Translation function using Qwen
async function translate(text, from, to) {
  try {
    const response = await openai.chat.completions.create({
      model: nameModel,
      messages: [
        {
          role: "system",
          content: "Translate the given text to the target language.",
        },
        {
          role: "user",
          content: `Translate from ${from} to ${to}: "${text}"`,
        },
      ],
    });

    return response.choices?.[0]?.message?.content || "Translation failed.";
  } catch (error) {
    console.error("Translation error:", error);
    return "Error in translation.";
  }
}

// Handle "message" events
slackEvents.on("message", async (event) => {
  console.log("Received a message event:", event);

  // Ignore bot messages
  if (event.bot_id) return;
  // const userIDsVi = ["UHAB0GQSV", "U06S7LLLS9J", "UMS2ENKSA", "U03UB5M9988"];
  const userIDsJp = ["U08BM8M5HDG"];

  try {
    const mess = event.text;
    // const senderId = event.user;
    const { content, userIDTagged } = parseSlackMessage(mess);
    const isUserJpTagged = userIDsJp.some((userId) =>
      userIDTagged.includes(userId)
    );
    const langCode = detectLanguage(content);
    const from = langCode;
    const to = langCode === "ja" ? "vi" : "ja"; // Translate to Japanese unless input is Japanese

    if (from !== "ja" && !isUserJpTagged) return;

    const textRes = await translate(content, from, to);
    const textFiltered = removeQuotes(textRes);
    await slackClient.chat.postMessage({
      channel: event.channel,
      text: `${textFiltered}`,
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
const app = express();

// Mount the slackEvents adapter as middleware at /slack/events
app.use("/slack/events", slackEvents.requestListener());

// Define a root route to return "Server is running"
app.get("/check", (req, res) => {
  res.send("Server is running");
});

// Start the Express server
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
  console.log("Slack Bot is ready to receive events!");
});
