type StoredRecord = {
  key: string
  bytes: ArrayBuffer
  revision: string
  updatedAtMs: number
}

const databaseName = 'liveagent-fx'
const storeName = 'records'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readRecord(key: string): Promise<StoredRecord | null> {
  const db = await openDatabase()
  return new Promise<StoredRecord | null>((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).get(key)
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => reject(request.error)
  }).finally(() => db.close())
}

async function writeRecord(key: string, bytes: Uint8Array, expectedRevision?: string) {
  const current = await readRecord(key)
  if (current?.revision !== expectedRevision) {
    const error = new Error('fx storage revision conflict') as Error & { code?: string }
    error.code = key === 'oauth' ? 'FX_OAUTH_SESSION_REVISION_CONFLICT' : 'FX_SESSION_REVISION_CONFLICT'
    throw error
  }
  const revision = crypto.randomUUID()
  const copy = bytes.slice().buffer
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put({
      key,
      bytes: copy,
      revision,
      updatedAtMs: Date.now(),
    } satisfies StoredRecord)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  }).finally(() => db.close())
  return { revision }
}

async function removeRecord(key: string, expectedRevision?: string) {
  const current = await readRecord(key)
  if (!current) return 'missing'
  if (expectedRevision !== undefined && current.revision !== expectedRevision) {
    const error = new Error('fx storage revision conflict') as Error & { code?: string }
    error.code = key === 'oauth' ? 'FX_OAUTH_SESSION_REVISION_CONFLICT' : 'FX_SESSION_REVISION_CONFLICT'
    throw error
  }
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  }).finally(() => db.close())
  return true
}

export const fxOAuthStore = {
  async load() {
    const record = await readRecord('oauth')
    return record ? { bytes: new Uint8Array(record.bytes), revision: record.revision } : null
  },
  commit(bytes: Uint8Array, expectedRevision?: string) {
    return writeRecord('oauth', bytes, expectedRevision)
  },
  remove(expectedRevision?: string) {
    return removeRecord('oauth', expectedRevision)
  },
}

export const fxSessionStore = {
  async load(id: string) {
    const record = await readRecord(`session:${id}`)
    return record ? { bytes: new Uint8Array(record.bytes), revision: record.revision } : null
  },
  commit(id: string, bytes: Uint8Array, expectedRevision?: string) {
    return writeRecord(`session:${id}`, bytes, expectedRevision)
  },
  async list() {
    const db = await openDatabase()
    return new Promise<Array<{ id: string; updatedAtMs: number }>>((resolve, reject) => {
      const request = db.transaction(storeName).objectStore(storeName).getAll()
      request.onsuccess = () => resolve(
        (request.result as StoredRecord[])
          .filter((record) => record.key.startsWith('session:'))
          .map((record) => ({ id: record.key.slice(8), updatedAtMs: record.updatedAtMs }))
          .sort((a, b) => b.updatedAtMs - a.updatedAtMs),
      )
      request.onerror = () => reject(request.error)
    }).finally(() => db.close())
  },
  remove(id: string) {
    return removeRecord(`session:${id}`)
  },
}

export const fxConfigStore = {
  get(id: string) {
    return localStorage.getItem(`liveagent.fx.config.${id}`)
  },
  set(id: string, value: string) {
    localStorage.setItem(`liveagent.fx.config.${id}`, value)
  },
}

export const fxPromptHistoryStore = {
  load(workspaceRoot: string, limit: number) {
    const entries = readPromptHistory(workspaceRoot)
    return entries.slice(Math.max(0, entries.length - limit)).map((entry) => entry.value)
  },
  append(workspaceRoot: string, value: string, timestampMs: number) {
    const entries = readPromptHistory(workspaceRoot)
    entries.push({ value, timestampMs })
    localStorage.setItem(promptHistoryKey(workspaceRoot), JSON.stringify(entries.slice(-500)))
    return true
  },
  clear(workspaceRoot: string) {
    localStorage.removeItem(promptHistoryKey(workspaceRoot))
  },
}

function promptHistoryKey(workspaceRoot: string) {
  return `liveagent.fx.history.${workspaceRoot}`
}

function readPromptHistory(workspaceRoot: string): Array<{ value: string; timestampMs: number }> {
  try {
    const value = JSON.parse(localStorage.getItem(promptHistoryKey(workspaceRoot)) ?? '[]')
    return Array.isArray(value) ? value.filter((entry) => typeof entry?.value === 'string') : []
  } catch {
    return []
  }
}
