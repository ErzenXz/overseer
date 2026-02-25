"use client";

import { useMemo, useState } from "react";
import type { InterfaceType } from "@/types/database";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";

export function EditInterfaceForm(props: {
 iface: { id: number; type: InterfaceType; name: string; is_active: number | boolean };
 allowedUsersCsv: string;
 configJson: string;
 discord: { clientId: string; allowedGuildsCsv: string };
 matrix: { homeserver: string; accessToken: string; roomIdsCsv: string };
 slack: { appToken: string; signingSecret: string };
 action: (formData: FormData) => void | Promise<void>;
}) {
 const initialType = props.iface.type;
 const [type, setType] = useState<InterfaceType>(initialType);

 const showBotToken = useMemo(
  () => type === "telegram" || type === "discord" || type === "slack",
  [type],
 );
 const showDiscord = type === "discord";
 const showSlack = type === "slack";
 const showMatrix = type === "matrix";

 return (
  <form action={props.action} className="space-y-4">
   <Input type="hidden" name="id" value={props.iface.id} />

   <div>
    <label className="block text-sm text-foreground mb-2">Type</label>
    <NativeSelect
     name="type"
     value={type}
     onChange={(e) => setType(e.target.value as InterfaceType)}
     className="w-full rounded border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    >
     <option value="telegram">Telegram</option>
     <option value="discord">Discord</option>
     <option value="slack">Slack</option>
     <option value="whatsapp">WhatsApp</option>
     <option value="matrix">Matrix</option>
     <option value="web">Web (Admin)</option>
    </NativeSelect>
   </div>

   <div>
    <label className="block text-sm text-foreground mb-2">Name</label>
    <Input
     name="name"
     defaultValue={props.iface.name}
     required
     className="w-full rounded border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    />
   </div>

   {showBotToken ? (
    <div>
     <label className="block text-sm text-foreground mb-2">
      Bot Token (leave blank to keep current)
     </label>
     <Input
      type="password"
      name="bot_token"
      className="w-full rounded border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
     />
    </div>
   ) : null}

   {showSlack ? (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
     <div>
      <label className="block text-sm text-foreground mb-2">
       Slack App Token (leave blank to keep current)
      </label>
      <Input
       type="password"
       name="slack_app_token"
       defaultValue={props.slack.appToken}
       className="w-full rounded border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
     </div>
     <div>
      <label className="block text-sm text-foreground mb-2">
       Slack Signing Secret (leave blank to keep current)
      </label>
      <Input
       type="password"
       name="slack_signing_secret"
       defaultValue={props.slack.signingSecret}
       className="w-full rounded border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
     </div>
    </div>
   ) : null}

   {showMatrix ? (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
     <div>
      <label className="block text-sm text-foreground mb-2">
       Homeserver URL (leave blank to keep current)
      </label>
      <Input
       name="matrix_homeserver"
       defaultValue={props.matrix.homeserver}
       className="w-full rounded border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
       placeholder="https://matrix.org"
      />
     </div>
     <div>
      <label className="block text-sm text-foreground mb-2">
       Access Token (leave blank to keep current)
      </label>
      <Input
       type="password"
       name="matrix_access_token"
       defaultValue={props.matrix.accessToken}
       className="w-full rounded border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
     </div>
     <div className="md:col-span-2">
      <label className="block text-sm text-foreground mb-2">
       Room IDs (optional)
      </label>
      <Input
       name="matrix_room_ids"
       defaultValue={props.matrix.roomIdsCsv}
       className="w-full rounded border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
       placeholder="!abc:matrix.org, !def:matrix.org"
      />
     </div>
    </div>
   ) : null}

   {showDiscord ? (
    <>
     <div>
      <label className="block text-sm text-foreground mb-2">
       Discord Client ID
      </label>
      <Input
       name="client_id"
       defaultValue={props.discord.clientId}
       className="w-full rounded border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
     </div>

     <div>
      <label className="block text-sm text-foreground mb-2">
       Allowed Guild IDs (Discord)
      </label>
      <Input
       name="allowed_guilds"
       defaultValue={props.discord.allowedGuildsCsv}
       className="w-full rounded border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
     </div>
    </>
   ) : null}

   <div>
    <label className="block text-sm text-foreground mb-2">
     Extra Config JSON (optional)
    </label>
    <Textarea
     name="config_json"
     defaultValue={props.configJson}
     rows={6}
     className="w-full rounded border border-border bg-muted px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
    />
    <p className="text-xs text-muted-foreground mt-1">
     Secrets are not shown here. Use the dedicated fields above to update secrets.
    </p>
   </div>

   <div>
    <label className="block text-sm text-foreground mb-2">Allowed User IDs</label>
    <Input
     name="allowed_users"
     defaultValue={props.allowedUsersCsv}
     className="w-full rounded border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    />
   </div>

   <label className="flex items-center gap-2 text-sm text-muted-foreground">
    <Input
     type="checkbox"
     name="is_active"
     defaultChecked={Boolean(props.iface.is_active)}
     className="rounded border-border bg-muted text-accent focus:ring-ring"
    />
    Active
   </label>

   <div className="pt-2">
    <button
     type="submit"
     className="px-4 py-2 rounded bg-primary hover:bg-primary-light text-primary-foreground text-sm font-medium transition-colors"
    >
     Save Changes
    </button>
   </div>
  </form>
 );
}

