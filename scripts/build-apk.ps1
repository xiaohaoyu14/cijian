param([switch]$Offline)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
function Check-Exit { if ($LASTEXITCODE -ne 0) { throw "Build command failed: $LASTEXITCODE" } }
npm run build
Check-Exit
python scripts/verify-piper-assets.py
Check-Exit
npx cap sync android
Check-Exit
$taskProxyUrl = if ($env:HTTPS_PROXY) { $env:HTTPS_PROXY } elseif ($env:HTTP_PROXY) { $env:HTTP_PROXY } else { $null }
if ($taskProxyUrl) {
 $taskProxy = [Uri]$taskProxyUrl
 $env:GRADLE_OPTS = "-Dhttps.proxyHost=$($taskProxy.Host) -Dhttps.proxyPort=$($taskProxy.Port) -Dhttp.proxyHost=$($taskProxy.Host) -Dhttp.proxyPort=$($taskProxy.Port) -Dorg.gradle.internal.http.connectionTimeout=15000 -Dorg.gradle.internal.http.socketTimeout=30000"
}
$taskSdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:USERPROFILE 'AndroidSdk' }
if (!(Test-Path -LiteralPath (Join-Path $taskSdk 'build-tools/35.0.0'))) { throw 'Install Android SDK build-tools 35.0.0; set ANDROID_HOME.' }
[IO.File]::WriteAllText((Join-Path $taskRoot 'android/local.properties'), "sdk.dir=$($taskSdk.Replace('\','/'))`n")
Push-Location android
try {
 if ($Offline) { .\gradlew.bat -I build-local.init.gradle assembleRelease --offline --console=plain } else { .\gradlew.bat -I build-local.init.gradle assembleRelease --console=plain }
 Check-Exit
} finally { Pop-Location }
python scripts/verify-piper-jni.py
Check-Exit
$taskSigning = Join-Path $taskRoot '.signing'
New-Item -ItemType Directory -Force -Path $taskSigning | Out-Null
$taskKey = Join-Path $taskSigning 'cijian-release.jks'
$taskPassFile = Join-Path $taskSigning 'password.txt'
if (!(Test-Path -LiteralPath $taskKey)) {
 $taskRandom = [byte[]]::new(32)
 [Security.Cryptography.RandomNumberGenerator]::Fill($taskRandom)
 [IO.File]::WriteAllText($taskPassFile, [Convert]::ToBase64String($taskRandom))
 keytool -genkeypair -keystore $taskKey -alias cijian -storepass:file $taskPassFile -keypass:file $taskPassFile -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Cijian, O=Local First, C=CN'
 Check-Exit
}
$taskOut = Join-Path $taskRoot 'deliverables'
New-Item -ItemType Directory -Force -Path $taskOut | Out-Null
$taskAligned = Join-Path $taskOut 'cijian-aligned.apk'
$taskVersion = (Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
$taskApkName = "词间-$taskVersion-arm64-v8a.apk"
$taskApk = Join-Path $taskOut $taskApkName
& (Join-Path $taskSdk 'build-tools/35.0.0/zipalign.exe') -f -P 16 4 'android/app/build/outputs/apk/release/app-release-unsigned.apk' $taskAligned
Check-Exit
& (Join-Path $taskSdk 'build-tools/35.0.0/apksigner.bat') sign --v4-signing-enabled false --ks $taskKey --ks-key-alias cijian --ks-pass "file:$taskPassFile" --out $taskApk $taskAligned
Check-Exit
& (Join-Path $taskSdk 'build-tools/35.0.0/apksigner.bat') verify --verbose $taskApk
Check-Exit
Remove-Item -LiteralPath $taskAligned
$taskHash = (Get-FileHash -LiteralPath $taskApk -Algorithm SHA256).Hash
[IO.File]::WriteAllText((Join-Path $taskOut 'SHA256.txt'), "$taskHash  $taskApkName`n")
Write-Output "APK ready: $taskApk"
