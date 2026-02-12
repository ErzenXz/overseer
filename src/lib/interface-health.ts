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
  const botToken =
    typeof config?.bot_token === "string" ? config.bot_token : "";

  if (!botToken) {
    return {
      ok: false,
      platform: iface.type,
      message: "Bot token is missing.",
    };
  }

  if (iface.type === "telegram") {
    return testTelegram(botToken);
  }

  if (iface.type === "discord") {
    return testDiscord(botToken);
  }

  return {
    ok: false,
    platform: iface.type,
    message: "Testing for this interface type is not implemented yet.",
  };
}
