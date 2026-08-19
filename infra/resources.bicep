@description('Azure region')
param location string

@description('Resource naming prefix')
@maxLength(12)
param prefix string

@description('Container image, e.g. ghcr.io/conduit-mcp/conduit-mcp:latest')
param image string

@description('Object id of the user bootstrapped as admin on first boot')
param bootstrapAdminOid string

@description('Entra tenant id for portal/MCP OAuth, blank on the bicep run that precedes setup-entra-app.ps1')
param entraTenantId string = ''

@description('Entra app (client) id for portal/MCP OAuth, blank on the bicep run that precedes setup-entra-app.ps1')
param entraClientId string = ''

@description('Object id of the operator running setup-entra-app.ps1, granted Key Vault Secrets Officer so its secret write succeeds (optional)')
param operatorObjectId string = ''

@description('Recover the soft-deleted key vault left by a deleted same-named deployment')
param recoverKeyVault bool = false

// image is public on ghcr, no registry credentials needed for pulls

// storage/kv/webapp names are globally unique across azure, prefix alone collides easily
var uniqueSuffix = uniqueString(resourceGroup().id)
// storage account: lowercase alnum only, <=24 chars
var storageAccountName = take(toLower(replace('${prefix}stg${uniqueSuffix}', '-', '')), 24)
// key vault: alnum+dash, <=24 chars
var keyVaultName = take('${prefix}-kv-${uniqueSuffix}', 24)
var webAppName = '${prefix}-app-${uniqueSuffix}'

// entra params are blank on the first bicep run (the entra script needs this run's kv name +
// webapp url first) -- omit the settings rather than seed a placeholder, seedAuthFromEnv's
// skip-if-set logic would otherwise never let the real values in on the second bicep run
var entraAppSettings = (!empty(entraTenantId) && !empty(entraClientId))
  ? [
      { name: 'ENTRA_TENANT_ID', value: entraTenantId }
      { name: 'ENTRA_CLIENT_ID', value: entraClientId }
    ]
  : []

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${prefix}-plan'
  location: location
  kind: 'linux'
  sku: {
    name: 'B2'
    tier: 'Basic'
  }
  properties: {
    reserved: true
  }
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  // take()'s statically-unknown min length trips BCP334, storageAccountName is always >=16 chars in practice
  #disable-next-line BCP334
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
    // no account-key data plane, the webapp MI reaches tables via data-plane rbac (role below)
    allowSharedKeyAccess: false
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    // purge protection holds a deleted vault's name for the retention window, so redeploying
    // into a same-named rg collides -- recoverKeyVault=true reclaims it (secrets included)
    createMode: recoverKeyVault ? 'recover' : 'default'
    // purge protection blocks permanent delete within the retention window; irreversible once
    // on, so enable it before the vault holds real credentials
    enablePurgeProtection: true
    softDeleteRetentionInDays: 90
  }
}

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  kind: 'app,linux,container'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOCKER|${image}'
      alwaysOn: true
      healthCheckPath: '/healthz'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: concat(
        [
          {
            name: 'WEBSITES_PORT'
            value: '8080'
          }
          {
            // explicit ephemeral /home: the cifs mount breaks non-root plugin writes, and
            // the loader re-clones pinned commits on restart anyway
            name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE'
            value: 'false'
          }
          {
            name: 'AZURE_STORAGE_TABLES_URL'
            value: storageAccount.properties.primaryEndpoints.table
          }
          {
            name: 'AZURE_KEYVAULT_URL'
            value: keyVault.properties.vaultUri
          }
          {
            name: 'BOOTSTRAP_ADMIN_OID'
            value: bootstrapAdminOid
          }
          {
            // opinionated public-cloud default hostname, not the deployed resource's own
            // property (self-reference would be circular) -- seedAuthFromEnv fills this
            // into the auth domain if it's still blank
            name: 'CONDUIT_SERVER_URL'
            value: 'https://${webAppName}.azurewebsites.net'
          }
        ],
        entraAppSettings
      )
    }
  }
}

// no basic-auth publishing path (kudu scm / ftp), deploy + sign-in are entra + MI only
resource scmBasicAuthOff 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: webApp
  name: 'scm'
  properties: {
    allow: false
  }
}

resource ftpBasicAuthOff 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: webApp
  name: 'ftp'
  properties: {
    allow: false
  }
}

// MI -> Storage Table Data Contributor on the storage account (config/dcr/roles tables)
resource storageRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, webApp.id, '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3')
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3' // Storage Table Data Contributor
    )
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// MI -> Key Vault Secrets Officer (read+write, admin UI manages credentials through it)
resource kvRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, webApp.id, 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'b86a8fe4-44ce-4948-aee5-eccb2c155cd7' // Key Vault Secrets Officer
    )
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// restart-only custom role for the portal's update-restart button. plugins run in-process
// and can mint MI tokens, so the MI never gets site-config write (image swap = takeover);
// worst case with restart alone is the app restart-looping itself
resource restartRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(resourceGroup().id, 'conduit-site-restart')
  properties: {
    roleName: 'Conduit Site Restart (${uniqueSuffix})'
    type: 'CustomRole'
    description: 'Restart the conduit web app, nothing else'
    permissions: [
      {
        actions: ['Microsoft.Web/sites/restart/action']
        notActions: []
      }
    ]
    assignableScopes: [resourceGroup().id]
  }
}

resource restartRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(webApp.id, webApp.id, 'conduit-site-restart')
  scope: webApp
  properties: {
    roleDefinitionId: restartRole.id
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// operator's own principal, not the webapp MI -- lets setup-entra-app.ps1's KV secret write
// succeed before the entra app (and its clientId) exist to grant the MI a reason to need it yet
resource operatorKvRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(operatorObjectId)) {
  name: guid(keyVault.id, operatorObjectId, 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'b86a8fe4-44ce-4948-aee5-eccb2c155cd7' // Key Vault Secrets Officer
    )
    principalId: operatorObjectId
    principalType: 'User'
  }
}

output webAppName string = webApp.name
output webAppUrl string = 'https://${webApp.properties.defaultHostName}'
output principalId string = webApp.identity.principalId
output keyVaultName string = keyVault.name
output storageAccountName string = storageAccount.name
