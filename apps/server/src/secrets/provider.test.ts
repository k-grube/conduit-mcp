import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSecretProvider,
  EnvSecretProvider,
  KeyVaultSecretProvider,
  SecretNotFoundError,
  TableSecretProvider,
} from './provider.js'

describe('EnvSecretProvider', () => {
  it('reads from env', async () => {
    process.env.TEST_SECRET_A = 'v'
    expect(await new EnvSecretProvider().getSecret('TEST_SECRET_A')).toBe('v')
  })

  it('throws SecretNotFoundError when unset', async () => {
    await expect(new EnvSecretProvider().getSecret('TEST_SECRET_MISSING')).rejects.toThrow(SecretNotFoundError)
  })

  it('setSecret throws read-only', async () => {
    await expect(new EnvSecretProvider().setSecret('A', 'b')).rejects.toThrow(/read-only/)
  })

  it('EnvSecretProvider is not writable', () => {
    expect(new EnvSecretProvider().writable).toBe(false)
  })
})

describe('KeyVaultSecretProvider', () => {
  function fakeClient() {
    const store = new Map<string, string>([['halopsa-client-id', 'abc']])
    return {
      getSecret: vi.fn(async (name: string) => {
        const value = store.get(name)
        if (value === undefined) {
          throw Object.assign(new Error('not found'), { statusCode: 404 })
        }
        return { value }
      }),
      setSecret: vi.fn(async (name: string, value: string) => {
        store.set(name, value)
        return { value }
      }),
    }
  }

  it('maps FOO_BAR to foo-bar', async () => {
    const client = fakeClient()
    const kv = new KeyVaultSecretProvider(client)
    expect(await kv.getSecret('HALOPSA_CLIENT_ID')).toBe('abc')
    expect(client.getSecret).toHaveBeenCalledWith('halopsa-client-id')
  })

  it('caches reads', async () => {
    const client = fakeClient()
    const kv = new KeyVaultSecretProvider(client)
    await kv.getSecret('HALOPSA_CLIENT_ID')
    await kv.getSecret('HALOPSA_CLIENT_ID')
    expect(client.getSecret).toHaveBeenCalledTimes(1)
  })

  it('setSecret writes through and updates cache', async () => {
    const client = fakeClient()
    const kv = new KeyVaultSecretProvider(client)
    await kv.setSecret('NEW_ONE', 'val')
    expect(client.setSecret).toHaveBeenCalledWith('new-one', 'val')
    expect(await kv.getSecret('NEW_ONE')).toBe('val')
    expect(client.getSecret).not.toHaveBeenCalled()
  })

  it('404 becomes SecretNotFoundError', async () => {
    const kv = new KeyVaultSecretProvider(fakeClient())
    await expect(kv.getSecret('NOPE')).rejects.toThrow(SecretNotFoundError)
  })

  it('KeyVaultSecretProvider is writable', () => {
    expect(new KeyVaultSecretProvider(fakeClient()).writable).toBe(true)
  })
})

describe('TableSecretProvider', () => {
  it('is writable and round-trips a secret through the table', async () => {
    const provider = new TableSecretProvider('SecretsT1')
    expect(provider.writable).toBe(true)
    await provider.setSecret('TSP_ROUNDTRIP', 'v1')
    expect(await provider.getSecret('TSP_ROUNDTRIP')).toBe('v1')
    await provider.setSecret('TSP_ROUNDTRIP', 'v2')
    expect(await provider.getSecret('TSP_ROUNDTRIP')).toBe('v2')
  })

  it('falls back to env when the table has no row', async () => {
    process.env.TSP_ENV_ONLY = 'from-env'
    expect(await new TableSecretProvider('SecretsT2').getSecret('TSP_ENV_ONLY')).toBe('from-env')
  })

  it('table row wins over env', async () => {
    process.env.TSP_BOTH = 'from-env'
    const provider = new TableSecretProvider('SecretsT3')
    await provider.setSecret('TSP_BOTH', 'from-table')
    expect(await provider.getSecret('TSP_BOTH')).toBe('from-table')
  })

  it('throws SecretNotFoundError when table and env both miss', async () => {
    await expect(new TableSecretProvider('SecretsT4').getSecret('TSP_MISSING')).rejects.toThrow(SecretNotFoundError)
  })
})

describe('createSecretProvider', () => {
  const saved = {
    kv: process.env.AZURE_KEYVAULT_URL,
    conn: process.env.AZURE_TABLES_CONNECTION_STRING,
  }

  afterEach(() => {
    process.env.AZURE_KEYVAULT_URL = saved.kv
    process.env.AZURE_TABLES_CONNECTION_STRING = saved.conn
    if (saved.kv === undefined) {
      delete process.env.AZURE_KEYVAULT_URL
    }
    if (saved.conn === undefined) {
      delete process.env.AZURE_TABLES_CONNECTION_STRING
    }
  })

  it('prefers keyvault when configured', () => {
    process.env.AZURE_KEYVAULT_URL = 'https://example.vault.azure.net'
    expect(createSecretProvider()).toBeInstanceOf(KeyVaultSecretProvider)
  })

  it('uses the table store for a loopback connection string', () => {
    delete process.env.AZURE_KEYVAULT_URL
    process.env.AZURE_TABLES_CONNECTION_STRING = 'TableEndpoint=http://127.0.0.1:10202/devstoreaccount1;'
    expect(createSecretProvider()).toBeInstanceOf(TableSecretProvider)
  })

  it('stays env-only for a non-loopback connection string', () => {
    delete process.env.AZURE_KEYVAULT_URL
    process.env.AZURE_TABLES_CONNECTION_STRING = 'TableEndpoint=https://real.table.core.windows.net;'
    expect(createSecretProvider()).toBeInstanceOf(EnvSecretProvider)
  })

  it('stays env-only with no table connection string', () => {
    delete process.env.AZURE_KEYVAULT_URL
    delete process.env.AZURE_TABLES_CONNECTION_STRING
    expect(createSecretProvider()).toBeInstanceOf(EnvSecretProvider)
  })
})
