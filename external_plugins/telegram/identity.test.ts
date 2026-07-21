import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { IdentityStore } from './identity.ts'

const dirs: string[] = []

function fixture(inventory: unknown, token = '12345:secret-value'): IdentityStore {
  const dir = mkdtempSync(join(tmpdir(), 'telegram-identity-'))
  dirs.push(dir)
  const tokenFile = join(dir, 'token.env')
  writeFileSync(tokenFile, `TELEGRAM_BOT_TOKEN=${token}\n`, { mode: 0o600 })
  const value = JSON.parse(JSON.stringify(inventory).replaceAll('$TOKEN_FILE', tokenFile))
  const inventoryFile = join(dir, 'identities.json')
  writeFileSync(inventoryFile, JSON.stringify(value), { mode: 0o600 })
  return new IdentityStore(inventoryFile)
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('IdentityStore', () => {
  test('lists metadata without reading or returning tokens', () => {
    const store = fixture({
      version: 1,
      identities: {
        'agent-b': { botId: '12345', tokenFile: '$TOKEN_FILE', label: 'Agent B' },
      },
    })
    expect(store.list()).toEqual([
      { name: 'agent-b', botId: '12345', botBusSelf: 'agent-b', label: 'Agent B' },
    ])
    expect(JSON.stringify(store.list())).not.toContain('secret-value')
  })

  test('resolves env token and verifies numeric bot id', () => {
    const store = fixture({
      version: 1,
      identities: {
        'agent-b': { botId: '12345', tokenFile: '$TOKEN_FILE', botBusSelf: 'bus-b' },
      },
    })
    expect(store.resolve('agent-b')).toEqual({
      name: 'agent-b', botId: '12345', botBusSelf: 'bus-b', token: '12345:secret-value',
    })
  })

  test('rejects token whose prefix disagrees with inventory', () => {
    const store = fixture({
      version: 1,
      identities: { 'agent-b': { botId: '99999', tokenFile: '$TOKEN_FILE' } },
    })
    expect(() => store.resolve('agent-b')).toThrow('does not match inventory')
  })

  test('missing inventory behaves as an empty pool', () => {
    const dir = mkdtempSync(join(tmpdir(), 'telegram-identity-'))
    dirs.push(dir)
    expect(new IdentityStore(join(dir, 'missing.json')).list()).toEqual([])
  })
})
