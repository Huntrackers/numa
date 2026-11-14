param([string]$CompilerRoot = $env:NUMA_NATIVE_TOOLCHAIN)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$cargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
if (!(Test-Path -LiteralPath $cargo)) { $cargo = (Get-Command cargo -ErrorAction Stop).Source }
if (!$CompilerRoot) {
    $CompilerRoot = Get-ChildItem -LiteralPath 'tools\native-compiler' -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\x86_64-w64-mingw32-clang.exe') } |
        Select-Object -First 1 -ExpandProperty FullName
}
if ($CompilerRoot) {
    $CompilerRoot = (Resolve-Path -LiteralPath $CompilerRoot).Path
    $bin = Join-Path $CompilerRoot 'bin'
    $runtime = Join-Path $CompilerRoot 'x86_64-w64-mingw32\bin'
    if (!(Test-Path -LiteralPath (Join-Path $runtime 'libunwind.dll')) -and
        !(Test-Path -LiteralPath (Join-Path $bin 'libunwind.dll'))) {
        throw 'The selected LLVM-MinGW installation is incomplete: libunwind.dll is missing. Set NUMA_NATIVE_TOOLCHAIN to its complete installation directory.'
    }
    $env:PATH = "$bin;$runtime;" + $env:PATH
    $env:CARGO_TARGET_X86_64_PC_WINDOWS_GNULLVM_LINKER = Join-Path $bin 'x86_64-w64-mingw32-clang.exe'
    $env:CC = $env:CARGO_TARGET_X86_64_PC_WINDOWS_GNULLVM_LINKER
    $env:CXX = Join-Path $bin 'x86_64-w64-mingw32-clang++.exe'
    $env:AWS_LC_SYS_PREBUILT_NASM = '1'
    & $cargo +stable-x86_64-pc-windows-gnullvm test --manifest-path contracts/payroll-vault/Cargo.toml --lib --locked
} else {
    $active = & (Join-Path (Split-Path -Parent $cargo) 'rustup.exe') show active-toolchain
    if ($LASTEXITCODE -ne 0 -or $active -notmatch 'windows-msvc') {
        throw 'Windows native contract tests need an MSVC Rust toolchain with C++ Build Tools, or LLVM-MinGW with NUMA_NATIVE_TOOLCHAIN set to its installation directory. No test binary was launched.'
    }
    & $cargo test --manifest-path contracts/payroll-vault/Cargo.toml --lib --locked
}
exit $LASTEXITCODE
