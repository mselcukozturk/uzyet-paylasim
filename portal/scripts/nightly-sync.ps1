# Her gece zamanlanmış görev tarafından çalıştırılır — Deneme sitesinin Neon veritabanındaki
# soru bankasını yerel web_quiz_bank.json ile senkronize eder. HTTP uç noktası
# (/api/admin/sync-bank) üzerinden çalışır — DATABASE_URL hiçbir makinede tutulmaz,
# yalnız sınırlı yetkili bir token (C:\Users\PC\.uzyet_sync_token) kullanılır. Eski
# .env.local/vercel-env-pull yolu Vercel'in Neon entegrasyonundaki ham değer/iç referans
# sorunu yüzünden defalarca sessizce atlıyordu (9 Eyl 2026'da bu yüzden terk edildi).
$ErrorActionPreference = "Stop"
$portalDir = Split-Path -Parent $PSScriptRoot
$logFile = Join-Path $portalDir "..\..\08 Sorular\birlestir\_nightly_sync_log.txt"
$bankPath = Join-Path $portalDir "..\..\08 Sorular\birlestir\web_quiz_bank.json"
$tokenPath = "$env:USERPROFILE\.uzyet_sync_token"

function Log($msg) {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path $logFile -Value "[$stamp] $msg"
}

if (-not (Test-Path $tokenPath)) {
    Log "ATLANDI: $tokenPath yok."
    exit 0
}
$token = (Get-Content $tokenPath -Raw).Trim()
$bankJson = Get-Content $bankPath -Raw -Encoding UTF8

try {
    $response = Invoke-RestMethod -Uri "https://uzyet-portal.vercel.app/api/admin/sync-bank" `
        -Method Post -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json; charset=utf-8" `
        -Body ([System.Text.Encoding]::UTF8.GetBytes($bankJson))
    Log "BASARILI: $($response | ConvertTo-Json -Compress)"
} catch {
    Log "HATA: $_"
}
