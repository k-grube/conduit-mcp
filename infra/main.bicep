targetScope = 'subscription'

@description('Azure region for all resources')
param location string = 'eastus2'

@description('Resource naming prefix')
@maxLength(12)
param prefix string = 'conduit'

@description('Container image pushed by CI (workflow prints the exact ghcr.io/<owner>/<repo>:<sha> value)')
param image string

@description('Object id of the user bootstrapped as admin on first boot')
param bootstrapAdminOid string

@description('Entra tenant id for portal/MCP OAuth (from setup-entra-app.ps1 output). Leave blank on the bicep run that precedes the script')
param entraTenantId string = ''

@description('Entra app (client) id for portal/MCP OAuth (from setup-entra-app.ps1 output). Leave blank on the bicep run that precedes the script')
param entraClientId string = ''

@description('Object id of the operator running setup-entra-app.ps1, granted Key Vault Secrets Officer (optional)')
param operatorObjectId string = ''

@description('Recover the soft-deleted key vault left by a deleted same-named deployment (purge protection holds its name for 90 days)')
param recoverKeyVault bool = false

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: '${prefix}-rg'
  location: location
}

module resources 'resources.bicep' = {
  name: 'resources'
  scope: rg
  params: {
    location: location
    prefix: prefix
    image: image
    bootstrapAdminOid: bootstrapAdminOid
    entraTenantId: entraTenantId
    entraClientId: entraClientId
    operatorObjectId: operatorObjectId
    recoverKeyVault: recoverKeyVault
  }
}

output webAppName string = resources.outputs.webAppName
output webAppUrl string = resources.outputs.webAppUrl
output principalId string = resources.outputs.principalId
output keyVaultName string = resources.outputs.keyVaultName
output storageAccountName string = resources.outputs.storageAccountName
