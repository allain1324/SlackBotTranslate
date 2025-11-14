require("dotenv").config();
const express = require("express");
const { createEventAdapter } = require("@slack/events-api");
const { WebClient } = require("@slack/web-api");
const langdetect = require("langdetect");
const OpenAI = require("openai");
const sqlite3 = require("sqlite3").verbose();

// === Load Environment Variables ===
const port = process.env.PORT || 3000;
const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
const slackToken = process.env.SLACK_BOT_TOKEN;
const apiKey = process.env.API_KEY;
const gptUrl = process.env.BASE_GPT_URL;
const nameModel = process.env.NAME_MODEL;
const botId = process.env.BOT_ID;
const userIDsVi = (process.env.USER_IDS_VN || '').split(',').map(s => s.trim()).filter(Boolean);
const userIDsJp = (process.env.USER_IDS_JP || '').split(',').map(s => s.trim()).filter(Boolean);

// === Initialize Slack Adapter & Client ===
const slackEvents = createEventAdapter(slackSigningSecret);
const slackClient = new WebClient(slackToken);

// === Initialize OpenAI Client (Qwen) ===
const openai = new OpenAI({
  apiKey: apiKey,
  baseURL: gptUrl,
});

// === Setup SQLite Database ===
const db = new sqlite3.Database("./translation_map.db", (err) => {
  if (err) {
    console.error("Error opening SQLite DB:", err);
  } else {
    db.run(
      `CREATE TABLE IF NOT EXISTS translation_mapping (
         original_ts TEXT PRIMARY KEY,
         translated_ts TEXT,
         channel TEXT NOT NULL
       )`,
      (err) => {
        if (err) console.error("Error creating table:", err);
      }
    );
  }
});

// === Utility Functions ===

/**
 * Remove quotes at the beginning or end of the text.
 */
function removeQuotes(text) {
  return text.replace(/^["「]|["」]$/g, "");
}

/**
 * Detect the language of the text.
 * Returns a language code (e.g. "ja", "vi", "en").
 */
function detectLanguage(text) {
  const detected = langdetect.detect(text);
  return detected && detected.length > 0 ? detected[0].lang : "ja";
}

/**
 * Parse a Slack message to extract tagged user IDs and clean the content.
 */
function parseSlackMessage(message) {
  const userIdRegex = /<@([A-Z0-9]+)>/g;
  const userIDs = [];
  let match;

  while ((match = userIdRegex.exec(message)) !== null) {
    userIDs.push(match[1]);
  }

  // Remove the bot's tag from the message (preserve other user tags).
  const content = message
    .replace(/<@([A-Z0-9]+)>/g, (full, userId) => {
      return userId === botId ? "" : full;
    })
    .trim();

  return { userIDTagged: userIDs, content };
}

/**
 * Call the OpenAI API (Qwen) to translate the given text.
 */
async function translate(text, from, to) {
  try {
    const response = await openai.chat.completions.create({
      model: nameModel,
      messages: [
        {
          role: "system",
          content: "Translate the given text to the target language.",
        },
        { role: "user", content: `Translate from ${from} to ${to}: "${text}"` },
      ],
    });
    return response.choices?.[0]?.message?.content || "Translation failed.";
  } catch (error) {
    console.error("Translation error:", error);
    return "Error in translation.";
  }
}

/**
 * Store a mapping between the original timestamp and the translated message timestamp.
 * Uses INSERT OR REPLACE to avoid UNIQUE constraint errors.
 */
function storeMapping(originalTs, translatedTs, channel) {
  db.run(
    `INSERT OR REPLACE INTO translation_mapping (original_ts, translated_ts, channel) VALUES (?, ?, ?)`,
    [originalTs, translatedTs, channel],
    (err) => {
      if (err) console.error("Error inserting mapping:", err);
      else console.log(`Stored mapping for message: ${originalTs}`);
    }
  );
}

/**
 * Update the mapping with a new translated_ts.
 */
function updateMapping(originalTs, translatedTs) {
  db.run(
    `UPDATE translation_mapping SET translated_ts = ? WHERE original_ts = ?`,
    [translatedTs, originalTs],
    (err) => {
      if (err) console.error("Error updating mapping:", err);
      else console.log(`Updated mapping for message: ${originalTs}`);
    }
  );
}

/**
 * Retrieve the mapping from the database for a given original timestamp.
 * Returns a Promise with the mapping.
 */
function getMapping(originalTs) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT translated_ts FROM translation_mapping WHERE original_ts = ?`,
      [originalTs],
      (err, row) => {
        if (err) {
          console.error("Error selecting mapping:", err);
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}

// === Main Slack Message Event Handler ===

slackEvents.on("message", async (event) => {
  console.log("Received message event:", event);

  // Ignore bot messages.
  if (event.bot_id || event?.message?.bot_id) return;

  try {
    const messageText = event.text ?? event.message.text;
    const { content, userIDTagged } = parseSlackMessage(messageText);
    const isUserJpTagged = userIDsJp.some((userId) =>
      userIDTagged.includes(userId)
    );
    const isUserViTagged = userIDsVi.some((userId) =>
      userIDTagged.includes(userId)
    );
    const isBotTagged = userIDTagged.includes(botId);
    const langCode = detectLanguage(content);
    const from = langCode;
    const to = langCode === "ja" ? "vi" : "ja";

    // Determine if translation should occur.
    const shouldTranslate =
      (from === "ja" && isUserViTagged) ||
      (from !== "ja" && isUserJpTagged) ||
      isBotTagged;

    if (shouldTranslate) {
      if (event.subtype === "message_changed") {
        console.log("Handling updated message event.");
        const originalTs = event.previous_message.ts;
        const originalMsg = event.previous_message.text;
        const newTranslatedText = await translate(content, from, to);
        const textFiltered = removeQuotes(newTranslatedText);

        if (originalMsg === messageText) return;

        try {
          const mapping = await getMapping(originalTs);
          if (mapping && mapping.translated_ts) {
            await slackClient.chat.update({
              channel: event.channel,
              ts: mapping.translated_ts,
              text: textFiltered,
            });
            console.log(`Updated translation for message ${originalTs}`);
          } else {
            const result = await slackClient.chat.postMessage({
              channel: event.channel,
              text: textFiltered,
              thread_ts: originalTs,
            });
            // Update or store the mapping.
            if (mapping) {
              updateMapping(originalTs, result.ts);
            } else {
              storeMapping(originalTs, result.ts, event.channel);
            }
          }
        } catch (err) {
          console.error("Error handling updated message:", err);
        }
      } else {
        // Handle new message events.
        const translatedText = await translate(content, from, to);
        const textFiltered = removeQuotes(translatedText);
        const result = await slackClient.chat.postMessage({
          channel: event.channel,
          text: textFiltered,
          thread_ts: event.event_ts,
        });
        storeMapping(event.ts, result.ts, event.channel);
      }
    } else {
      // Even if not translating, store a mapping to handle potential future updates.
      storeMapping(event.ts, null, event.channel);
    }
  } catch (error) {
    console.error("Error handling message event:", error);
  }
});

// Log Slack adapter errors.
slackEvents.on("error", console.error);

// === Initialize Express App ===
const app = express();
app.use("/slack/events", slackEvents.requestListener());
app.get("/check", (req, res) => res.send("Server is running"));

// Start the server.
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
  console.log("Slack Bot is ready to receive events!");
});
