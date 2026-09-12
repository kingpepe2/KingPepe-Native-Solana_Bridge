# Copyright (c) 2026 KingPepe Team. All Rights Reserved.
# Called once per service process. Compiles only the adjacent reviewed sources
# with the installed Windows .NET Framework compiler. Never changes policy.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$kpStage = 'INPUT'
try {
    if (-not [Console]::IsInputRedirected -or -not [Console]::IsOutputRedirected) { throw 'REDIRECTED_IO_REQUIRED' }
    $kpInput = New-Object System.Text.StringBuilder
    $kpBuffer = New-Object char[] 1024
    while (($kpRead = [Console]::In.Read($kpBuffer, 0, $kpBuffer.Length)) -gt 0) {
        if ($kpInput.Length + $kpRead -gt 4096) { throw 'REQUEST_TOO_LARGE' }
        [void]$kpInput.Append($kpBuffer, 0, $kpRead)
    }
    $kpRequest = $kpInput.ToString() | ConvertFrom-Json
    if (@($kpRequest.PSObject.Properties.Name).Count -ne 1 -or -not ($kpRequest.root -is [string])) { throw 'BUILD_REQUEST_REJECTED' }
    $kpSourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
    $kpStoreSource = Join-Path $PSScriptRoot 'ProtectedStore.cs'
    $kpEntrySource = Join-Path $PSScriptRoot 'ProtectedStoreExecutable.cs'
    $kpStage = 'SOURCE_COMPILE'
    Add-Type -AssemblyName System.Security
    Add-Type -Path $kpStoreSource -ReferencedAssemblies System.Security
    $kpStage = 'PRIVATE_DIRECTORY'
    [KingPepe.LocalProtection.ProtectedStore]::CreateExecutableDirectory($kpRequest.root, $kpSourceRoot)
    $kpCompiler = Join-Path ([Environment]::GetFolderPath('Windows')) 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    $kpStage = 'FRAMEWORK_COMPILER'
    if (-not [IO.File]::Exists($kpCompiler)) { throw 'WINDOWS_FRAMEWORK_COMPILER_REQUIRED' }
    $kpExecutable = Join-Path $kpRequest.root 'protected-store.exe'
    $kpStage = 'EXECUTABLE_COMPILE'
    $kpDiagnostics = @(& $kpCompiler '/nologo' '/target:exe' '/optimize+' '/platform:anycpu' '/reference:System.Security.dll' '/reference:System.Web.Extensions.dll' ("/out:" + $kpExecutable) $kpStoreSource $kpEntrySource 2>&1)
    if ($LASTEXITCODE -ne 0 -or $kpDiagnostics.Count -ne 0) { throw 'HELPER_BUILD_FAILED' }
    $kpStage = 'EXECUTABLE_POLICY'
    [KingPepe.LocalProtection.ProtectedStore]::CheckExecutableDirectory($kpExecutable, $kpSourceRoot)
    $kpStage = 'RESULT'
    $kpHash = (Get-FileHash -LiteralPath $kpExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
    $kpVersionInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($kpCompiler)
    $kpVersion = '{0}.{1}.{2}.{3}' -f $kpVersionInfo.FileMajorPart, $kpVersionInfo.FileMinorPart, $kpVersionInfo.FileBuildPart, $kpVersionInfo.FilePrivatePart
    if ($kpVersion -notmatch '^[0-9. ]{1,80}$') { throw 'COMPILER_IDENTITY_REJECTED' }
    [Console]::Out.Write((@{protocol='KINGPEPE_PROTECTED_EXECUTABLE_BUILD_V1';sha256=$kpHash;compilerVersion=$kpVersion} | ConvertTo-Json -Compress))
    exit 0
} catch {
    # Fixed stage only: never exception messages, paths, identities or input.
    $kpReason = 'POLICY'
    for ($kpException = $_.Exception; $null -ne $kpException; $kpException = $kpException.InnerException) {
        $kpCandidate = $kpException.Data['ProtectedBuildReason']
        if ($kpCandidate -is [string] -and $kpCandidate -match '^(POLICY|ROOT_CANONICAL|ROOT_FIXED_DRIVE|ROOT_SOURCE_BOUNDARY|ROOT_REPARSE|DIRECTORY_PARENT|DIRECTORY_CREATE_[0-9]{1,6}|ACL_PRINCIPAL|ACL_INHERITANCE|ACL_RULE_COUNT|ACL_ACCESS)$') { $kpReason = $kpCandidate }
    }
    [Console]::Error.Write('WINDOWS_PROTECTED_HELPER_BUILD_REJECTED:' + $kpStage + ':' + $kpReason)
    exit 1
}
