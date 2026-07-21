import { chmodSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, join } from 'path'

export type IdentityEntry = {
  botId: string
  tokenFile: string
  tokenKey?: string
  botBusSelf?: string
  label?: string
}

export type IdentitySummary = {
  name: string
  botId: string
  botBusSelf: string
  label?: string
}

export type ResolvedIdentity = IdentitySummary & {
  token: string
}

type IdentityInventory = {
  version: number
  identities: Record<string, IdentityEntry>
}

const IDENTITY_NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const BOT_ID_RE = /^[0-9]+$/

function expandHome(path: string): string {
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
}

function parseInventory(path: string): IdentityInventory {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { version: 1, identities: {} }
    throw new Error(`identity inventory ${path}: ${err instanceof Error ? err.message : err}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`identity inventory ${path}: root must be an object`)
  }
  const raw = parsed as Partial<IdentityInventory>
  if (raw.version !== 1) throw new Error(`identity inventory ${path}: version must be 1`)
  if (!raw.identities || typeof raw.identities !== 'object' || Array.isArray(raw.identities)) {
    throw new Error(`identity inventory ${path}: identities must be an object`)
  }
  for (const [name, value] of Object.entries(raw.identities)) {
    if (!IDENTITY_NAME_RE.test(name)) throw new Error(`identity inventory ${path}: invalid name ${JSON.stringify(name)}`)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`identity inventory ${path}: ${name} must be an object`)
    }
    const entry = value as Partial<IdentityEntry>
    if (typeof entry.botId !== 'string' || !BOT_ID_RE.test(entry.botId)) {
      throw new Error(`identity inventory ${path}: ${name}.botId must be a numeric string`)
    }
    if (typeof entry.tokenFile !== 'string' || entry.tokenFile.trim() === '') {
      throw new Error(`identity inventory ${path}: ${name}.tokenFile is required`)
    }
    const tokenFile = expandHome(entry.tokenFile)
    if (!isAbsolute(tokenFile)) {
      throw new Error(`identity inventory ${path}: ${name}.tokenFile must be absolute or start with ~/`)
    }
    const self = entry.botBusSelf ?? name
    if (!IDENTITY_NAME_RE.test(self)) {
      throw new Error(`identity inventory ${path}: ${name}.botBusSelf is invalid`)
    }
    if (entry.tokenKey != null && !/^\w+$/.test(entry.tokenKey)) {
      throw new Error(`identity inventory ${path}: ${name}.tokenKey is invalid`)
    }
    if (entry.label != null && typeof entry.label !== 'string') {
      throw new Error(`identity inventory ${path}: ${name}.label must be a string`)
    }
  }
  return raw as IdentityInventory
}

function readToken(entry: IdentityEntry): string {
  const path = expandHome(entry.tokenFile)
  try {
    chmodSync(path, 0o600)
  } catch {}
  let content: string
  try {
    content = readFileSync(path, 'utf8').trim()
  } catch (err) {
    throw new Error(`token file for bot ${entry.botId}: ${err instanceof Error ? err.message : err}`)
  }
  const key = entry.tokenKey ?? 'TELEGRAM_BOT_TOKEN'
  if (content.includes('=')) {
    const line = content.split('\n').find(raw => raw.trim().startsWith(`${key}=`))
    content = line?.trim().slice(key.length + 1).trim() ?? ''
  }
  const match = /^(\d+):([^\s]+)$/.exec(content)
  if (!match) throw new Error(`token file for bot ${entry.botId}: no usable token`)
  if (match[1] !== entry.botId) {
    throw new Error(`token file bot id ${match[1]} does not match inventory botId ${entry.botId}`)
  }
  return content
}

export class IdentityStore {
  constructor(readonly path: string) {}

  list(): IdentitySummary[] {
    const inventory = parseInventory(this.path)
    return Object.entries(inventory.identities)
      .map(([name, entry]) => ({
        name,
        botId: entry.botId,
        botBusSelf: entry.botBusSelf ?? name,
        ...(entry.label ? { label: entry.label } : {}),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  resolve(name: string): ResolvedIdentity {
    const inventory = parseInventory(this.path)
    const entry = inventory.identities[name]
    if (!entry) throw new Error(`unknown identity ${JSON.stringify(name)}; use identity action=list`)
    return {
      name,
      botId: entry.botId,
      botBusSelf: entry.botBusSelf ?? name,
      ...(entry.label ? { label: entry.label } : {}),
      token: readToken(entry),
    }
  }
}
