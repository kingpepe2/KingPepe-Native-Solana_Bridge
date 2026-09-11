# Copyright (c) 2026 KingPepe Team. All Rights Reserved.
# Private material uses redirected anonymous pipes only, never arguments/files.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
try {
    if (-not [Console]::IsInputRedirected -or -not [Console]::IsOutputRedirected) { throw 'REDIRECTED_IO_REQUIRED' }
    Add-Type -AssemblyName System.Security
    Add-Type -AssemblyName System.Web.Extensions
    Add-Type -Path (Join-Path $PSScriptRoot 'ProtectedStore.cs') -ReferencedAssemblies System.Security
    $kpSerializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $kpSerializer.MaxJsonLength = 1500000
    # Bounded read; do not let an arbitrary input pipe allocate unlimited memory.
    $kpInput = New-Object System.Text.StringBuilder
    $kpBuffer = New-Object char[] 4096
    while (($kpRead = [Console]::In.Read($kpBuffer, 0, $kpBuffer.Length)) -gt 0) {
        if ($kpInput.Length + $kpRead -gt 1500000) { throw 'REQUEST_TOO_LARGE' }
        [void]$kpInput.Append($kpBuffer, 0, $kpRead)
    }
    $kpRequest = $kpSerializer.DeserializeObject($kpInput.ToString())
    $kpSourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
    $kpResponse = [KingPepe.LocalProtection.ProtectedStore]::Execute($kpRequest, $kpSourceRoot)
    [Console]::Out.Write($kpSerializer.Serialize($kpResponse))
    exit 0
} catch {
    # Never forward exception messages, stack traces, request fields or paths.
    [Console]::Error.Write('WINDOWS_PROTECTED_STORE_REJECTED')
    exit 1
}
