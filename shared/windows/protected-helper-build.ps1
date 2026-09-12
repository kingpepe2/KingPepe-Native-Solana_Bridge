# Copyright (c) 2026 KingPepe Team. All Rights Reserved.
# Called once per service process. Compiles only the adjacent reviewed sources
# with the installed Windows .NET Framework compiler. Never changes policy.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
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
    Add-Type -AssemblyName System.Security
    Add-Type -Path $kpStoreSource -ReferencedAssemblies System.Security
    [KingPepe.LocalProtection.ProtectedStore]::CreateExecutableDirectory($kpRequest.root, $kpSourceRoot)
    $kpCompiler = Join-Path ([Environment]::GetFolderPath('Windows')) 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    if (-not [IO.File]::Exists($kpCompiler)) { throw 'WINDOWS_FRAMEWORK_COMPILER_REQUIRED' }
    $kpExecutable = Join-Path $kpRequest.root 'protected-store.exe'
    $kpDiagnostics = @(& $kpCompiler '/nologo' '/target:exe' '/optimize+' '/platform:anycpu' '/reference:System.Security.dll' '/reference:System.Web.Extensions.dll' ("/out:" + $kpExecutable) $kpStoreSource $kpEntrySource 2>&1)
    if ($LASTEXITCODE -ne 0 -or $kpDiagnostics.Count -ne 0) { throw 'HELPER_BUILD_FAILED' }
    [KingPepe.LocalProtection.ProtectedStore]::CheckExecutableDirectory($kpExecutable, $kpSourceRoot)
    $kpHash = (Get-FileHash -LiteralPath $kpExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
    $kpVersionInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($kpCompiler)
    $kpVersion = '{0}.{1}.{2}.{3}' -f $kpVersionInfo.FileMajorPart, $kpVersionInfo.FileMinorPart, $kpVersionInfo.FileBuildPart, $kpVersionInfo.FilePrivatePart
    if ($kpVersion -notmatch '^[0-9. ]{1,80}$') { throw 'COMPILER_IDENTITY_REJECTED' }
    [Console]::Out.Write((@{protocol='KINGPEPE_PROTECTED_EXECUTABLE_BUILD_V1';sha256=$kpHash;compilerVersion=$kpVersion} | ConvertTo-Json -Compress))
    exit 0
} catch {
    [Console]::Error.Write('WINDOWS_PROTECTED_HELPER_BUILD_REJECTED')
    exit 1
}
