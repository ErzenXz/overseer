export async function planWorkspaceAutomation(params: {
  goal: string;
  apps?: string[];
}): Promise<{
  goal: string;
  apps: string[];
  phases: string[];
  risks: string[];
}> {
  const apps =
    params.apps && params.apps.length > 0
      ? params.apps
      : ["Gmail", "Sheets", "Drive"];

  return {
    goal: params.goal,
    apps,
    phases: [
      "Define inputs, outputs, and ownership",
      "Map data flow between selected Workspace apps",
      "Implement a minimal Apps Script prototype",
      "Add error handling and notifications",
      "Pilot with one team and collect feedback",
      "Roll out with documentation and monitoring",
    ],
    risks: [
      "Missing sharing permissions across drives/sheets",
      "Trigger quotas or Apps Script execution limits",
      "Inconsistent sheet schema/versioning",
    ],
  };
}

export async function draftWorkspaceEmail(params: {
  to_name: string;
  subject: string;
  context: string;
}): Promise<{ subject: string; body: string }> {
  const body = `Hi ${params.to_name},\n\n${params.context}\n\nIf this works for you, I can share a draft implementation plan in Google Docs and a tracking sheet for next steps.\n\nBest regards,\nOverseer`;

  return {
    subject: params.subject,
    body,
  };
}
