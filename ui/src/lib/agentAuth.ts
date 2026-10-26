import { api } from '../api'
import { agentInfo } from '../agents'

// What to type on a machine to sign an agent in. Codex uses the device-code
// flow because it works on machines with no browser; the rest come from the
// catalog.
export function loginCommand(agentId: string): string | undefined {
  if (agentId === 'codex') return 'codex login --device-auth'
  if (agentId === 'claude') return 'claude auth login'
  return agentInfo(agentId).login
}

export type AgentErrorKind = 'auth' | 'limit' | 'network' | 'other'

// classifyAgentError turns an agent's raw error text into something a person
// can act on. Agents report failures in their own words (“workspace routing
// discovery unauthorized (401)”), so this is a set of patterns, not an enum.
export function classifyAgentError(text: string): AgentErrorKind {
  if (/\b401\b|unauthori[sz]ed|not (logged|signed) in|please (log|sign) ?in|log ?in required|\/login\b|invalid[_ ](api[_ -]?key|x-api-key|authentication|credentials)|authentication[_ ](failed|required|error)|token (has )?(expired|is invalid)|credentials? (are |is )?(missing|expired)|no (api key|credentials)/i.test(text)) return 'auth'
  if (/usage limit|rate[_ ]limit|\b429\b|quota|out of (credits|usage)|insufficient[_ ]credit|limit (reached|exceeded)|overloaded|too many requests/i.test(text)) return 'limit'
  if (/ECONN(REFUSED|RESET)|ENOTFOUND|ETIMEDOUT|getaddrinfo|network (error|is unreachable)|socket hang up|fetch failed|timed? ?out|offline/i.test(text)) return 'network'
  return 'other'
}

// startLogin opens a terminal session on the machine that runs the agent's
// sign-in command, and returns its name.
export async function startLogin(deviceId: string, agentId: string): Promise<string> {
  const command = loginCommand(agentId)
  if (!command) throw new Error('No sign-in command is known for this agent')
  const session = `login-${agentId}-${Date.now().toString().slice(-5)}`
  await api.post(`/api/devices/${deviceId}/sessions`, { name: session, command, kind: 'setup' })
  return session
}
