export type QboEnvironment = 'sandbox' | 'production'

export interface QboSecretNames {
  clientId: string
  clientSecret: string
  refreshToken: string
}

export function secretNamesFor(env: QboEnvironment): QboSecretNames {
  const prefix = env === 'sandbox' ? 'QBO_SANDBOX' : 'QBO_PROD'
  return {
    clientId: `${prefix}_CLIENT_ID`,
    clientSecret: `${prefix}_CLIENT_SECRET`,
    refreshToken: `${prefix}_REFRESH_TOKEN`,
  }
}
