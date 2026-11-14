$ErrorActionPreference='Stop'
$pidFile=Join-Path $PSScriptRoot 'logs\processes.json'
if(!(Test-Path -LiteralPath $pidFile)){Write-Output 'No numa-managed processes are recorded.';exit 0}
$savedData=ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($pidFile))
foreach($record in $savedData){
 if($null -eq $record.id -or !$record.marker){continue}
 try{
  $proc=Get-Process -Id $record.id -ErrorAction Stop
  $info=Get-CimInstance Win32_Process -Filter ('ProcessId='+$record.id)
  $expected=if($record.startedAt -is [DateTime]){$record.startedAt.ToUniversalTime().Ticks}else{([DateTimeOffset]::Parse([string]$record.startedAt)).UtcDateTime.Ticks}
  if($proc.StartTime.ToUniversalTime().Ticks -eq $expected -and $info.CommandLine.IndexOf([string]$record.marker,[StringComparison]::OrdinalIgnoreCase) -ge 0){
   Stop-Process -Id $record.id
   Write-Output ('Stopped numa '+$record.role)
  }
 }catch{}
}
'[]' | Set-Content -LiteralPath $pidFile -Encoding utf8
