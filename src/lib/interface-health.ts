import { interfacesModel } from "@/database";
import { recordChannelEvent } from "@/lib/channel-observability";

export interface InterfaceHealth {
  ok: boolean;
  platform: string;
  message: string;
  details?: Record<string, unknown>;
}

async function testTelegram(botToken: string): Promise<InterfaceHealth> {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/getMe`,
    {
      method: "GET",
      cache: "no-store",
    },
  );

  const data = (await response.json()) as {
    ok?: boolean;
    result?: { username?: string; id?: number };
    description?: string;
  };

  if (!response.ok || !data.ok) {
    recordChannelEvent({
      channel: "telegram",
      event: "health_check",
      ok: false,
      details: {
        status: response.status,
        description: data.description,
      },
    });

    return {
      ok: false,
      platform: "telegram",
      message: data.description || "Telegram token validation failed.",
    };
  }

  recordChannelEvent({
    channel: "telegram",
    event: "health_check",
    ok: true,
    details: {
      botId: data.result?.id,
      username: data.result?.username,
    },
  });

  return {
    ok: true,
    platform: "telegram",
    message: `Connected as @${data.result?.username || "unknown"}`,
    details: {
      botId: data.result?.id,
      username: data.result?.username,
    },
  };
}

async function testDiscord(botToken: string): Promise<InterfaceHealth> {
  const response = await fetch("https://discord.com/api/v10/users/@me", {
    method: "GET",
    headers: {
      Authorization: `Bot ${botToken}`,
    },
    cache: "no-store",
  });

  const data = (await response.json()) as {
    id?: string;
    username?: string;
    discriminator?: string;
    message?: string;
  };

  if (!response.ok) {
    recordChannelEvent({
      channel: "discord",
      event: "health_check",
      ok: false,
      details: {
        status: response.status,
        message: data.message,
      },
    });

    return {
      ok: false,
      platform: "discord",
      message: data.message || "Discord token validation failed.",
    };
  }

  recordChannelEvent({
    channel: "discord",
    event: "health_check",
    ok: true,
    details: {
      botId: data.id,
      username: data.username,
    },
  });

  return {
    ok: true,
    platform: "discord",
    message: `Connected as ${data.username || "unknown"}${data.discriminator ? `#${data.discriminator}` : ""}`,
    details: {
      botId: data.id,
      username: data.username,
      discriminator: data.discriminator,
    },
  };
}

async function testSlack(botToken: string): Promise<InterfaceHealth> {
  // Slack "auth.test" validates the bot token.
  const response = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "pretty=0",
    cache: "no-store",
  });

  const data = (await response.json()) as {
    ok?: boolean;
    error?: string;
    team?: string;
    user?: string;
    bot_id?: string;
  };

  if (!response.ok || !data.ok) {
    recordChannelEvent({
      channel: "slack",
      event: "health_check",
      ok: false,
      details: { status: response.status, error: data.error },
    });

    return {
      ok: false,
      platform: "slack",
      message: data.error || "Slack token validation failed.",
    };
  }

  recordChannelEvent({
    channel: "slack",
    event: "health_check",
    ok: true,
    details: { team: data.team, user: data.user, botId: data.bot_id },
  });

  return {
    ok: true,
    platform: "slack",
    message: `Connected to Slack${data.team ? ` (${data.team})` : ""}`,
    details: { team: data.team, user: data.user, botId: data.bot_id },
  };
}

async function testMatrix(config: Record<string, unknown>): Promise<InterfaceHealth> {
  const homeserver = typeof config.homeserver === "string" ? config.homeserver : "";
  const accessToken = typeof config.access_token === "string" ? config.access_token : "";

  if (!homeserver || !accessToken) {
    return {
      ok: false,
      platform: "matrix",
      message: "Matrix homeserver or access_token missing in config.",
    };
  }

  const url = `${homeserver.replace(/\/+$/, "")}/_matrix/client/v3/account/whoami`;
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  const data = (await response.json()) as { user_id?: string; errcode?: string; error?: string };

  if (!response.ok) {
    recordChannelEvent({
      channel: "matrix",
      event: "health_check",
      ok: false,
      details: { status: response.status, errcode: data.errcode, error: data.error },
    });
    return {
      ok: false,
      platform: "matrix",
      message: data.error || data.errcode || "Matrix token validation failed.",
    };
  }

  recordChannelEvent({
    channel: "matrix",
    event: "health_check",
    ok: true,
    details: { userId: data.user_id },
  });

  return {
    ok: true,
    platform: "matrix",
    message: `Connected as ${data.user_id || "unknown"}`,
    details: { userId: data.user_id },
  };
}

export async function testInterfaceById(
  interfaceId: number,
): Promise<InterfaceHealth> {
  const iface = interfacesModel.findById(interfaceId);
  if (!iface) {
    return {
      ok: false,
      platform: "unknown",
      message: "Interface not found.",
    };
  }

  const config = interfacesModel.getDecryptedConfig(interfaceId);
  const botToken = typeof config?.bot_token === "string" ? config.bot_token : "";

  if (iface.type === "telegram") {
    if (!botToken) {
      return { ok: false, platform: "telegram", message: "Bot token is missing." };
    }
    return testTelegram(botToken);
  }

  if (iface.type === "discord") {
    if (!botToken) {
      return { ok: false, platform: "discord", message: "Bot token is missing." };
    }
    return testDiscord(botToken);
  }

  if (iface.type === "slack") {
    if (!botToken) {
      return { ok: false, platform: "slack", message: "Bot token is missing." };
    }
    return testSlack(botToken);
  }

  if (iface.type === "matrix") {
    return testMatrix((config || {}) as Record<string, unknown>);
  }

  if (iface.type === "whatsapp") {
    return {
      ok: true,
      platform: "whatsapp",
      message:
        "WhatsApp is pairing-based. Start the WhatsApp worker to generate a QR/pairing code and complete login.",
    };
  }

  return {
    ok: false,
    platform: iface.type,
    message: "Testing for this interface type is not implemented yet.",
  };
}
