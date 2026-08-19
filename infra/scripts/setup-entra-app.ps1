# idempotent setup for the Entra app registration backing the portal SPA + MCP
# OAuth proxy (apps/server/src/auth/oauth.ts swaps every DCR client's client_id
# for this one app before forwarding to Entra's /authorize and /token).
# re-runnable: existing apps are reconciled (redirect uris merged, api scope
# ensured, manifest fields pinned) without destroying unrelated app state.
#
# run bicep first (no entra params) -- ProdUrl/KeyVaultName below come from its outputs
# pass -operatorObjectId <your-oid> on that bicep run or this script's KV write 403s
#
# usage:
#   ./setup-entra-app.ps1 `
#     -DisplayName "conduit-mcp" `
#     -ProdUrl "<webAppUrl from bicep output>" `
#     -KeyVaultName "<keyVaultName from bicep output>"
#
#   # preview without touching the tenant or key vault:
#   ./setup-entra-app.ps1 -DisplayName "conduit-mcp" -ProdUrl "<webAppUrl from bicep output>" -KeyVaultName "<keyVaultName from bicep output>" -DryRun
#
#   # rotate the client secret and push the new value to key vault:
#   ./setup-entra-app.ps1 -DisplayName "conduit-mcp" -ProdUrl "..." -KeyVaultName "..." -RotateSecret
#
# prereqs:
#   - az login as a user with Application.ReadWrite.OwnedBy on the tenant
#   - az account set to the subscription holding the key vault
#   - PowerShell 7+

[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $DisplayName,
    [Parameter(Mandatory)] [string] $ProdUrl,
    [Parameter(Mandatory)] [string] $KeyVaultName,
    [string] $SecretName = 'azure-client-secret',
    [string] $DevUrl = 'http://localhost:3000',
    [switch] $RotateSecret,
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'

$ProdUrl = $ProdUrl.TrimEnd('/')
$DevUrl = $DevUrl.TrimEnd('/')
$DevUrlLoopback = $DevUrl -replace 'localhost', '127.0.0.1'

# portal SPA signs in against the deployed app's origin (and the local dev server).
# msal.ts sends window.location.origin, which never has a trailing slash -- Entra
# exact-matches redirect uris, a registered trailing slash means every sign-in 401s
$spaRedirects = @(
    $ProdUrl
    $DevUrl
)

# mcp oauth proxy forwards the caller's own redirect_uri straight to Entra
# (apps/server/src/auth/oauth.ts), so every host DcrClientsStore's allowlist
# accepts (apps/server/src/auth/dcr-store.ts DEFAULT_REDIRECT_HOSTS) needs a
# matching entry registered here or Entra rejects the /authorize call
$webRedirects = @(
    'https://claude.ai/api/mcp/auth_callback'
    "$DevUrl/api/mcp/auth_callback"
    "$DevUrlLoopback/api/mcp/auth_callback"
)

# claude code cli loopback listener, ephemeral port per flow. public client platform: entra ignores
# the port on http://localhost there, and the proxy's secret-less pkce exchange needs a public-client uri
$publicClientRedirects = @(
    'http://localhost/callback'
)

$dcrDefaultHosts = @('claude.ai', 'localhost', '127.0.0.1')

# Microsoft Graph (00000003-0000-0000-c000-000000000000) application permission ids,
# read by apps/server/src/admin/graph-client.ts via the app's own client credential
$graphResourceId = '00000003-0000-0000-c000-000000000000'
$graphPerms = @(
    @{ id = 'df021288-bdef-4463-88db-98f22de89214'; type = 'Role'; name = 'User.Read.All (application)' }
    @{ id = '5b567255-7703-4780-807c-7be8301ae99b'; type = 'Role'; name = 'Group.Read.All (application)' }
)

function Show-Plan {
    Write-Host "[dry-run] plan for app '$DisplayName' (no az/graph calls made)"
    Write-Host "[dry-run] ensure app registration exists (sign-in-audience AzureADMyOrg), create if missing"
    Write-Host "[dry-run] reconcile redirect uris:"
    Write-Host "[dry-run]   spa: $($spaRedirects -join ', ')"
    Write-Host "[dry-run]   web: $($webRedirects -join ', ')"
    Write-Host "[dry-run]   publicClient: $($publicClientRedirects -join ', ')"
    Write-Host "[dry-run] ensure api scopes 'portal.access', 'mcp.access' under api://<clientId> (reuse existing scope ids if present)"
    Write-Host "[dry-run] pin requestedAccessTokenVersion=2, groupMembershipClaims=SecurityGroup"
    Write-Host "[dry-run] set isFallbackPublicClient=true (mcp callback does a secret-less pkce token exchange)"
    Write-Host "[dry-run] request graph application permissions: $(($graphPerms | ForEach-Object { $_.name }) -join ', ')"
    Write-Host "[dry-run]   admin consent NOT granted automatically -- reminder printed, not executed"
    Write-Host "[dry-run] ensure a service principal exists for the app"
    Write-Host "[dry-run] $(if ($RotateSecret) { 'rotate' } else { 'ensure' }) client secret, store at Key Vault '$KeyVaultName' as secret '$SecretName'"
    Write-Host ""
    Write-Host "[dry-run] output block (placeholders -- real values need a live run):"
    Write-Host "[dry-run]   tenantId: <az account show --query tenantId>"
    Write-Host "[dry-run]   clientId: <existing app's appId, or the newly created one>"
    Write-Host "[dry-run]   scope uris: api://<clientId>/portal.access, api://<clientId>/mcp.access"
    Write-Host "[dry-run]   redirect-uri audit vs DCR defaults ($($dcrDefaultHosts -join ', ')):"
    foreach ($h in $dcrDefaultHosts) {
        $covered = (@($webRedirects) + @($publicClientRedirects) | Where-Object { $_ -match [regex]::Escape($h) }).Count -gt 0
        Write-Host "[dry-run]     $h -> $(if ($covered) { 'covered' } else { 'NOT covered' })"
    }
}

function Find-OrCreateApp {
    Write-Host "[entra] looking up app '$DisplayName'..."
    $existing = az ad app list --display-name $DisplayName --query "[?displayName=='$DisplayName']" | ConvertFrom-Json
    if ($existing.Count -gt 0) {
        Write-Host "[entra] found existing appId=$($existing[0].appId)"
        return $existing[0]
    }
    Write-Host "[entra] no app found, creating..."
    $created = az ad app create --display-name $DisplayName --sign-in-audience AzureADMyOrg | ConvertFrom-Json
    Write-Host "[entra] created appId=$($created.appId)"
    return $created
}

function Merge-Redirects([array] $current, [array] $desired) {
    # union, preserve order: keep existing first then append new ones
    $set = [System.Collections.Generic.HashSet[string]]::new()
    $merged = @()
    foreach ($u in $current) {
        if ($set.Add($u)) { $merged += $u }
    }
    foreach ($u in $desired) {
        if ($set.Add($u)) { $merged += $u }
    }
    return ,$merged
}

function Set-RedirectUris($appObjectId) {
    Write-Host "[entra] reconciling redirect uris..."
    $current = az ad app show --id $appObjectId --query "{web: web.redirectUris, spa: spa.redirectUris, publicClient: publicClient.redirectUris}" | ConvertFrom-Json

    $newWeb = Merge-Redirects @($current.web) $webRedirects
    $newSpa = Merge-Redirects @($current.spa) $spaRedirects
    $newPublic = Merge-Redirects @($current.publicClient) $publicClientRedirects

    az ad app update --id $appObjectId --web-redirect-uris @newWeb | Out-Null

    # az cli has no --spa-redirect-uris on every version, patch via graph directly by object id
    $body = @{ spa = @{ redirectUris = $newSpa }; publicClient = @{ redirectUris = $newPublic } } | ConvertTo-Json -Compress
    az rest --method PATCH `
        --uri "https://graph.microsoft.com/v1.0/applications/$appObjectId" `
        --headers 'Content-Type=application/json' `
        --body $body | Out-Null

    Write-Host "[entra]   web: $($newWeb -join ', ')"
    Write-Host "[entra]   spa: $($newSpa -join ', ')"
    Write-Host "[entra]   publicClient: $($newPublic -join ', ')"
}

# portal.access: portal spa sign-in, checked by apps/server/src/auth/portal.ts
# mcp.access: mcp oauth flow, apps/server/src/auth/oauth.ts requests it so entra mints an
# mcp-audience token instead of a graph-audience one (EntraValidator pins aud=clientId)
$apiScopes = @(
    @{
        value                   = 'portal.access'
        adminConsentDisplayName = 'Access the conduit portal'
        adminConsentDescription = 'Allows the app to access the conduit portal on behalf of the signed-in user.'
        userConsentDisplayName  = 'Access the conduit portal on your behalf'
        userConsentDescription  = 'Allows the app to access the conduit portal on your behalf.'
    }
    @{
        value                   = 'mcp.access'
        adminConsentDisplayName = 'Access the conduit MCP server'
        adminConsentDescription = 'Allows the app to access the conduit MCP server on behalf of the signed-in user.'
        userConsentDisplayName  = 'Access the conduit MCP server on your behalf'
        userConsentDescription  = 'Allows the app to access the conduit MCP server on your behalf.'
    }
)

function Set-ApiScope($appObjectId, $clientId) {
    Write-Host "[entra] ensuring api://$clientId scopes ($(($apiScopes | ForEach-Object { $_.value }) -join ', '))..."
    $current = az ad app show --id $appObjectId --query 'api' | ConvertFrom-Json
    $existingScopes = @($current.oauth2PermissionScopes)

    # rebuild the full scope list every time (the PATCH below replaces api.oauth2PermissionScopes wholesale),
    # keeping existing ids stable and only minting a new guid for a scope that isn't there yet
    $scopes = @()
    $added = @()
    foreach ($s in $apiScopes) {
        $existing = $existingScopes | Where-Object { $_.value -eq $s.value }
        if ($existing) {
            $scopes += $existing
            continue
        }
        $scopeId = [guid]::NewGuid().ToString()
        $scopes += @{
            id                      = $scopeId
            type                    = 'User'
            value                   = $s.value
            isEnabled               = $true
            adminConsentDisplayName = $s.adminConsentDisplayName
            adminConsentDescription = $s.adminConsentDescription
            userConsentDisplayName  = $s.userConsentDisplayName
            userConsentDescription  = $s.userConsentDescription
        }
        $added += "$($s.value) (id=$scopeId)"
    }

    if ($added.Count -gt 0) {
        $api = @{
            requestedAccessTokenVersion = 2
            oauth2PermissionScopes      = $scopes
        }
        $body = @{ api = $api; identifierUris = @("api://$clientId") } | ConvertTo-Json -Depth 6 -Compress
        az rest --method PATCH `
            --uri "https://graph.microsoft.com/v1.0/applications/$appObjectId" `
            --headers 'Content-Type=application/json' `
            --body $body | Out-Null
        Write-Host "[entra]   added scope(s): $($added -join ', ')"
    } else {
        Write-Host "[entra]   all scopes already present"
    }

    # always pin requestedAccessTokenVersion to 2, apps/server/src/auth/entra.ts verifies v2 tokens only
    if ($current.requestedAccessTokenVersion -ne 2) {
        $body = @{ api = @{ requestedAccessTokenVersion = 2 } } | ConvertTo-Json -Compress
        az rest --method PATCH `
            --uri "https://graph.microsoft.com/v1.0/applications/$appObjectId" `
            --headers 'Content-Type=application/json' `
            --body $body | Out-Null
        Write-Host "[entra]   pinned requestedAccessTokenVersion=2"
    }
}

function Set-PublicClient($appObjectId) {
    Write-Host "[entra] ensuring isFallbackPublicClient=true..."
    $current = az ad app show --id $appObjectId --query 'isFallbackPublicClient' -o tsv
    if ($current -eq 'true') {
        Write-Host "[entra]   already set"
        return
    }
    # mcp callback is a secret-less pkce token exchange (the oauth proxy strips client_secret before
    # forwarding), entra rejects that against a confidential (web) client without this flag
    $body = @{ isFallbackPublicClient = $true } | ConvertTo-Json -Compress
    az rest --method PATCH `
        --uri "https://graph.microsoft.com/v1.0/applications/$appObjectId" `
        --headers 'Content-Type=application/json' `
        --body $body | Out-Null
    Write-Host "[entra]   set isFallbackPublicClient=true"
}

function Set-GroupClaims($appObjectId) {
    Write-Host "[entra] ensuring groupMembershipClaims=SecurityGroup..."
    $current = az ad app show --id $appObjectId --query 'groupMembershipClaims' -o tsv
    if ($current -eq 'SecurityGroup') {
        Write-Host "[entra]   already SecurityGroup"
        return
    }
    $body = @{ groupMembershipClaims = 'SecurityGroup' } | ConvertTo-Json -Compress
    az rest --method PATCH `
        --uri "https://graph.microsoft.com/v1.0/applications/$appObjectId" `
        --headers 'Content-Type=application/json' `
        --body $body | Out-Null
    Write-Host "[entra]   set groupMembershipClaims=SecurityGroup"
}

function Set-GraphPermissions($appObjectId) {
    Write-Host "[entra] ensuring graph application permissions..."
    foreach ($p in $graphPerms) {
        az ad app permission add --id $appObjectId --api $graphResourceId --api-permissions "$($p.id)=$($p.type)" 2>$null | Out-Null
        Write-Host "[entra]   $($p.name) requested"
    }
    Write-Host "[entra]   NOT granting admin consent automatically, see reminder in the output block below"
}

function Ensure-ServicePrincipal($clientId) {
    Write-Host "[entra] ensuring service principal exists..."
    $existing = az ad sp list --filter "appId eq '$clientId'" | ConvertFrom-Json
    if ($existing.Count -eq 0) {
        az ad sp create --id $clientId | Out-Null
        Write-Host "[entra]   created"
    } else {
        Write-Host "[entra]   already exists"
    }
}

function Set-ClientSecret($appObjectId) {
    if (-not $RotateSecret) {
        try {
            $existingSecret = az keyvault secret show --vault-name $KeyVaultName --name $SecretName 2>$null | ConvertFrom-Json
        } catch {
            $existingSecret = $null
        }
        if ($existingSecret) {
            Write-Host "[entra] client secret already in Key Vault; pass -RotateSecret to roll it."
            return
        }
    }
    Write-Host "[entra] creating new client secret (existing credentials remain valid until rotated)..."
    $cred = az ad app credential reset --id $appObjectId --append --display-name "auto-$(Get-Date -Format 'yyyyMMdd-HHmm')" --years 2 | ConvertFrom-Json
    Write-Host "[entra]   secret created, expires $($cred.endDateTime)"
    # az keyvault secret set has no stdin form, --value would put the raw secret in this
    # process's argv (visible via ps/task manager) -- --file only exposes the temp path
    $secretFile = New-TemporaryFile
    try {
        Set-Content -Path $secretFile -Value $cred.password -NoNewline
        az keyvault secret set --vault-name $KeyVaultName --name $SecretName --file $secretFile --encoding utf-8 | Out-Null
    } finally {
        Remove-Item -Path $secretFile -Force
    }
    Write-Host "[entra]   stored in Key Vault: $KeyVaultName/$SecretName"
}

# ---- main ----

if ($DryRun) {
    Show-Plan
    exit 0
}

$app = Find-OrCreateApp
$appObjectId = $app.id
$clientId = $app.appId

Set-RedirectUris $appObjectId
Set-ApiScope $appObjectId $clientId
Set-PublicClient $appObjectId
Set-GroupClaims $appObjectId
Set-GraphPermissions $appObjectId
Ensure-ServicePrincipal $clientId
Set-ClientSecret $appObjectId

$tenantId = az account show --query tenantId -o tsv

Write-Host ""
Write-Host "[entra] done."
Write-Host "[entra]   tenantId: $tenantId"
Write-Host "[entra]   clientId: $clientId"
Write-Host "[entra]   scope uris: api://$clientId/portal.access, api://$clientId/mcp.access"
Write-Host "[entra]   secretRef: @Microsoft.KeyVault(VaultName=$KeyVaultName;SecretName=$SecretName)"
Write-Host "[entra]   redirect-uri audit vs DCR defaults ($($dcrDefaultHosts -join ', ')):"
foreach ($h in $dcrDefaultHosts) {
    $covered = (@($webRedirects) + @($publicClientRedirects) | Where-Object { $_ -match [regex]::Escape($h) }).Count -gt 0
    Write-Host "[entra]     $h -> $(if ($covered) { 'covered' } else { 'NOT covered' })"
}
Write-Host ""
Write-Host "[entra] reminder: grant admin consent for $(($graphPerms | ForEach-Object { $_.name }) -join ', ')"
Write-Host "[entra]   Enterprise Applications > $DisplayName > API permissions > Grant admin consent"
Write-Host "[entra]   or: az ad app permission admin-consent --id $clientId"
Write-Host ""
Write-Host "[entra] deploy order: bicep (no entra params) -> this script (-KeyVaultName/-ProdUrl from its outputs) -> bicep again"
Write-Host "[entra]   re-run bicep with -entraTenantId $tenantId -entraClientId $clientId, then restart the app so seedAuthFromEnv picks them up"
Write-Host "[entra]   this script's KV write needs Key Vault Secrets Officer on your own principal -- pass -operatorObjectId <your-oid> on the first bicep run"
