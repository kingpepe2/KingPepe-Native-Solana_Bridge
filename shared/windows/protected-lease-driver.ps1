# Copyright (c) 2026 KingPepe Team. All Rights Reserved.
# A private inherited child-process pipe controls a held OS file handle.
# This is not inter-service authentication or a PID-based identity check.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$kpLease = $null
try {
    if (-not [Console]::IsInputRedirected -or -not [Console]::IsOutputRedirected) { throw 'REDIRECTED_IO_REQUIRED' }
    Add-Type -AssemblyName System.Security
    Add-Type -AssemblyName System.Web.Extensions
    Add-Type -Path (Join-Path $PSScriptRoot 'ProtectedStore.cs') -ReferencedAssemblies System.Security
    $kpSerializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $kpSerializer.MaxJsonLength = 131072
    $kpInput = New-Object System.Text.StringBuilder
    while (($kpChar = [Console]::In.Read()) -ne 10) {
        if ($kpChar -lt 0 -or $kpInput.Length -ge 131072) { throw 'LEASE_INPUT_REJECTED' }
        [void]$kpInput.Append([char]$kpChar)
    }
    $kpRequest = $kpSerializer.DeserializeObject($kpInput.ToString())
    $kpSourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
    $kpLease = [KingPepe.LocalProtection.ProtectedStore]::AcquireLifetimeLease($kpRequest, $kpSourceRoot)
    [Console]::Out.WriteLine('KINGPEPE_LEASE_READY_V1')
    [Console]::Out.Flush()
    # EOF (including parent termination) releases the handle. Any other input fails.
    if ([Console]::In.Read() -ne -1) { throw 'LEASE_INPUT_REJECTED' }
} catch {
    [Console]::Error.Write('WINDOWS_PROTECTED_LEASE_REJECTED')
    exit 1
} finally {
    if ($null -ne $kpLease) { $kpLease.Dispose() }
}
