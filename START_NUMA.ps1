param([switch]$NoBrowser,[switch]$NoModel)
$ErrorActionPreference='Stop'
$nomaRoot=$PSScriptRoot
Set-Location -LiteralPath $nomaRoot
$nodePath=(Get-Command node.exe -ErrorAction Stop).Source
$logDir=Join-Path $nomaRoot 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$pidFile=Join-Path $logDir 'processes.json'
$records=New-Object 'System.Collections.Generic.List[object]'
if(Test-Path -LiteralPath $pidFile){
 $savedData=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($pidFile))
 foreach($record in $savedData){if($null -ne $record.id -and $record.role -and $record.marker){$records.Add($record)}}
}
function Is-OwnedProcess($record){
 try{
  $proc=Get-Process -Id $record.id -ErrorAction Stop
  $info=Get-CimInstance Win32_Process -Filter ('ProcessId='+$record.id)
  $expected=if($record.startedAt -is [DateTime]){$record.startedAt.ToUniversalTime().Ticks}else{([DateTimeOffset]::Parse([string]$record.startedAt)).UtcDateTime.Ticks}
  return ($proc.StartTime.ToUniversalTime().Ticks -eq $expected -and $info.CommandLine.IndexOf([string]$record.marker,[StringComparison]::OrdinalIgnoreCase) -ge 0)
 }catch{return $false}
}
function Save-Record($record){
 for($i=$records.Count-1;$i -ge 0;$i--){if($records[$i].role -eq $record.role){$records.RemoveAt($i)}}
 $records.Add($record)
 ConvertTo-Json -InputObject ([object[]]$records.ToArray()) -Depth 4 | Set-Content -LiteralPath $pidFile -Encoding utf8
}
function Start-NomaComponent($role,$binary,$arguments,$marker){
 foreach($existing in $records){if($existing.role -eq $role -and (Is-OwnedProcess $existing)){return $existing}}
 $proc=Start-Process -FilePath $binary -ArgumentList $arguments -WorkingDirectory $nomaRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir ($role+'.log')) -RedirectStandardError (Join-Path $logDir ($role+'-error.log')) -PassThru
 return [pscustomobject]@{role=$role;id=$proc.Id;startedAt=$proc.StartTime.ToUniversalTime().ToString('o');marker=$marker}
}
try{$health=Invoke-RestMethod -Uri 'http://127.0.0.1:4310/api/v1/health' -TimeoutSec 2}catch{$health=$null}
if($health -and $health.name -notin @('numa','Noma')){throw 'Port 4310 is used by another application.'}
if(!$health){
 $apiScript=Join-Path $nomaRoot 'apps\api\src\server.ts'
 Save-Record (Start-NomaComponent 'api' $nodePath @('--import','tsx',('"'+$apiScript+'"')) $apiScript)
}
$workerScript=Join-Path $nomaRoot 'apps\worker\src\index.ts'
Save-Record (Start-NomaComponent 'worker' $nodePath @('--import','tsx',('"'+$workerScript+'"')) $workerScript)
if(!$NoModel){
 $ollamaPath=Join-Path $nomaRoot 'tools\ollama\runtime\ollama.exe'
 if(Test-Path -LiteralPath $ollamaPath){
  try{$modelService=Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2}catch{$modelService=$null}
  if(!$modelService){
   $env:OLLAMA_HOST='127.0.0.1:11434'
   $env:OLLAMA_MODELS=Join-Path $nomaRoot 'tools\ollama\models'
   $env:OLLAMA_NO_CLOUD='1'
   Save-Record (Start-NomaComponent 'model' $ollamaPath @('serve') $ollamaPath)
   for($modelAttempt=0;$modelAttempt -lt 20;$modelAttempt++){
    try{$modelService=Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 1;if($modelService){break}}catch{}
    Start-Sleep -Milliseconds 500
   }
   if(!$modelService){Write-Output 'The optional local model is still starting. Financial tools remain available.'}
  }
 }
}
for($attempt=0;$attempt -lt 30;$attempt++){
 try{$health=Invoke-RestMethod -Uri 'http://127.0.0.1:4310/api/v1/health' -TimeoutSec 1;if($health.status -eq 'ok'){break}}catch{}
 Start-Sleep -Milliseconds 500
}
if(!$health -or $health.status -ne 'ok'){throw 'numa did not start. Check logs/api-error.log.'}
Write-Output 'numa is ready: http://127.0.0.1:4310'
if(!$NoBrowser){Start-Process 'http://127.0.0.1:4310' -WindowStyle Hidden}
