---
lead: More than one person can use the same hub, each with their own sign-in. Chat apps send agents' questions to Telegram, Slack or Discord, so you can answer from your phone.
---

## Teams

A hub with one person looks exactly as it always has: you sign in with your password, and none of the team features show. They appear as soon as a second person joins.

### Add people

Open **Settings → People**. Under **Invite someone**, click **Create invite link**. You can type who it's for, so you remember which link is whose. Send them the link. They choose a name and password and join as a **member**.

- The link works once and expires after 7 days.
- It's shown only when you create it. Pending links are listed below with a **Revoke** button.
- Once there is more than one person on the hub, signing in asks for a name and a password.

### Roles

Everyone is an **owner** or a **member**. Owners change someone's role from the **⋯** menu next to their name. A hub always keeps at least one owner.

| | Owner | Member |
| --- | --- | --- |
| Start, steer and approve sessions, hand them off, share links | Yes | Yes |
| Use Automations, Review, Mission control and the Arena | Yes | Yes |
| Change your own name, email and password | Yes | Yes |
| Invite people, change roles, disable or remove people | Yes | No |
| See the **Activity** log | Yes | No |
| Add or remove machines, create cloud machines | Yes | No |
| API tokens, chat apps, software updates, preview address | Yes | No |

Everyone on the hub can open every session. **Mine** and **Everyone** only change what the list shows.

An owner can also **Disable** someone, which signs them out and blocks sign-in until they're enabled again, or **Remove** them. A removed person's sessions stay, under their name.

### Working together

- **Mine and Everyone.** A menu at the top of the sessions panel filters the list. **Mine** shows sessions you started or that were handed to you.
- **Who's here.** Small avatars at the top of a session show who else has it open right now.
- **Hand off.** In a session's **⋯** menu, choose **Hand off to…**, pick a teammate and add a note of up to 500 characters, like where you left off. The session moves to their **Needs you** group and they get a notice. The session shows who handed it over and your note.
- **Approved by.** When someone answers an approval, the thread says who, like "Approved by Sam".

### Activity log

**Settings → Activity** is for owners. It lists, newest first, who did what: sign-ins and failed sign-ins, invites, role changes, approvals, hand-offs, sessions started, stopped or deleted, terminals, API tokens, updates and machine changes. Click **Show older** for more.

### After you upgrade

When teams arrive on an existing hub, your admin password becomes the first owner, named **Admin**, and your existing sessions are theirs. Rename yourself in **Settings → People → Your profile**.

Sign-ins are kept in memory, so the hub restarting for the upgrade signs everyone out once. Sign in again with your usual password and you're back where you were.

## Chat apps

Chat apps get a message when an agent needs you, and let you answer it right there. Open **Settings → Chat apps**.

Overseer connects out to each service, so you don't need a public address. Only the chat you link can answer, and every answer goes through the same path as the buttons in the app. Tokens are saved on your hub and shown shortened; they're never sent back to the browser in full.

| App | How it works | Can answer? |
| --- | --- | --- |
| **Telegram** | A chat with your own bot. Easiest to set up | Yes |
| **Slack** | Buttons in a channel or direct message, over Slack's Socket Mode | Yes |
| **Discord** | Buttons in a channel, through a bot you create | Yes |
| **Webhook** | Posts a JSON event to a URL, for ntfy, Home Assistant, n8n and the like | No |

### Telegram

1. In Telegram, open [@BotFather](https://t.me/BotFather) and send `/newbot`. Choose a name and a username.
2. Copy the token BotFather gives you, paste it into **Bot token** and click **Save token**.
3. Click **Connect**. Overseer shows a message like `/start <code>`. Send it to your bot in Telegram, or click **Open in Telegram** first. The code works for 10 minutes.

The page shows **Linked** once the chat is connected. Overseer polls Telegram for new messages, so there's no webhook to set up.

### Slack

1. At [api.slack.com/apps](https://api.slack.com/apps), choose **Create New App → From a manifest** and paste the manifest from **Slack app manifest** on the Chat apps page. It turns on Socket Mode and buttons, with the `chat:write` and `im:write` scopes.
2. Install the app to your workspace and copy the **Bot User OAuth Token** (`xoxb-…`).
3. Under **Basic Information → App-Level Tokens**, make a token with the `connections:write` scope (`xapp-…`).
4. In Slack, invite the bot to a private channel with `/invite @Overseer`. Paste that channel's ID. For a direct message instead, paste your own member ID (`U…`).
5. Click **Connect Slack**, then **Send a test message** and press **Link me** in Slack.

### Discord

1. In the [Discord developer portal](https://discord.com/developers/applications), create an application and add a **Bot**. Press **Reset Token** and copy it.
2. Turn on Developer Mode (User Settings → Advanced), right-click your channel and choose **Copy Channel ID**. Use a private channel only you can see.
3. Paste the token and channel ID, then click **Connect Discord**.
4. Click **Invite the bot** to add it to your server, then **Send a test message** and press **Link me**.

Leave "Interactions Endpoint URL" empty in the developer portal. Buttons arrive over the bot's own connection.

### Webhook

Paste a URL, and Overseer sends a JSON `POST` for each event you choose. The URL is treated as a secret: it's saved on the hub and shown shortened.

Add a **signing secret** and every request carries an `X-Overseer-Signature` header, `sha256=` followed by the HMAC-SHA256 of the request body, so your receiver can check it came from your hub. The kind of event is in the `X-Overseer-Event` header. **Send a test event** shows you the payload.

### Choose what you get

Once an app is connected, it has the same settings:

- **Send messages** pauses the app without losing its setup.
- **What to send:** **Needs approval** and **Asks a question** are on by default. **Finished** and **Failed** are optional.
- **Machines** limits messages to the machines you pick. The default is all of them.
- **Show "Always allow"** adds the standing-permission button. Turn it off to keep standing permissions in the app, so chat only offers **Allow once** and **Reject**.
- **Who can answer** lists the Slack or Discord user IDs allowed to press buttons. The first person to press **Link me** is added for you. On Telegram, it's the person in the linked chat.

**Disconnect** deletes the saved tokens from the hub.

> [!WARNING]
> Anyone who can press the buttons can allow an agent to run commands on your machines. Keep the channel private, and keep **Who can answer** to people you'd trust at the keyboard.
