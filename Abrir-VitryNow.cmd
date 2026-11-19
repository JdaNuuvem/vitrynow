@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0" || exit /b 1
if /i "%~1"=="--executar" goto :executar
set "VITRY_LOG=%~dp0VitryNow-inicializacao.log"
set "VITRY_ACAO=iniciar"
if /i "%~1"=="parar" set "VITRY_ACAO=parar"
echo Acompanhe o progresso nesta janela. O registro fica em "%VITRY_LOG%".
powershell.exe -NoProfile -NonInteractive -Command "& '.\Abrir-VitryNow.cmd' --executar $env:VITRY_ACAO 2>&1 | ForEach-Object { $_.ToString() } | Tee-Object -FilePath $env:VITRY_LOG; exit $LASTEXITCODE"
if errorlevel 1 goto :reportar_erro
exit /b 0

:executar
set "VITRY_ENV=infra\.env.vitry.local"
set "COMPOSE_FILE=infra\docker-compose.local.yml"
if not defined VITRY_LOCAL_PROJECT set "VITRY_LOCAL_PROJECT=vitry-local"
if not defined VITRY_LOCAL_WEB_PORT set "VITRY_LOCAL_WEB_PORT=3000"
if not defined VITRY_LOCAL_API_PORT set "VITRY_LOCAL_API_PORT=3001"
powershell.exe -NoProfile -NonInteractive -Command "$p=$env:VITRY_LOCAL_PROJECT; $w=$env:VITRY_LOCAL_WEB_PORT; $a=$env:VITRY_LOCAL_API_PORT; if ($p -cnotmatch '^[a-z][a-z0-9_-]{0,48}$' -or $w -notmatch '^[1-9][0-9]{0,4}$' -or $a -notmatch '^[1-9][0-9]{0,4}$' -or [int]$w -gt 65535 -or [int]$a -gt 65535 -or $w -eq $a) { Write-Host 'Informe nome e portas locais validos e distintos.'; exit 1 }"
if errorlevel 1 exit /b 1
if not exist "%COMPOSE_FILE%" (
  echo Falta infra\docker-compose.local.yml. Extraia o ZIP completo e execute o inicializador dentro da pasta extraida.
  exit /b 1
)
rem O Explorer pode ter sido aberto antes da instalacao do Docker Desktop.
if exist "%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin\docker.exe" set "PATH=%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin;%PATH%"
if exist "%ProgramFiles%\Docker\Docker\resources\bin\docker.exe" set "PATH=%PATH%;%ProgramFiles%\Docker\Docker\resources\bin"
echo [1/4] Verificando Docker Desktop e Compose...
where docker.exe >nul 2>nul
if errorlevel 1 goto :no_docker
set "LOCAL_ENDPOINT=%DOCKER_HOST%"
if not defined LOCAL_ENDPOINT for /f "delims=" %%H in ('docker context inspect --format "{{.Endpoints.docker.Host}}"') do set "LOCAL_ENDPOINT=%%H"
if /i "%LOCAL_ENDPOINT:~0,8%"=="npipe://" goto :local_engine
if /i "%LOCAL_ENDPOINT:~0,16%"=="tcp://127.0.0.1:" goto :local_engine
if /i "%LOCAL_ENDPOINT:~0,16%"=="tcp://localhost:" goto :local_engine
echo O contexto Docker atual nao aponta para este computador. Selecione o Docker Desktop local.
goto :failed

:local_engine
set "DOCKER_CONTEXT="
set "DOCKER_HOST=%LOCAL_ENDPOINT%"
docker compose version
if errorlevel 1 goto :no_docker
echo Usando motor local: %LOCAL_ENDPOINT%
set "VITRY_ENGINE="
for /f "delims=" %%T in ('docker info --format "{{.OSType}}"') do set "VITRY_ENGINE=%%T"
if not defined VITRY_ENGINE (
  echo O Docker nao respondeu a esta conta do Windows. Veja a mensagem do Docker acima.
  exit /b 1
)
if /i not "%VITRY_ENGINE%"=="linux" (
  echo O motor ativo e "%VITRY_ENGINE%". Selecione containers Linux no Docker Desktop.
  exit /b 1
)
if /i "%~2"=="parar" goto :stop
echo [2/4] Preparando o banco local...
if not exist "%VITRY_ENV%" (
  powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $rng=[Security.Cryptography.RandomNumberGenerator]::Create(); $keys='DB_PASSWORD','JWT','MFA','ENCRYPTION','REVALIDATE'; $lines=foreach($key in $keys){$bytes=New-Object byte[] 48; $rng.GetBytes($bytes); 'VITRY_LOCAL_'+$key+'='+[BitConverter]::ToString($bytes).Replace('-','')}; $rng.Dispose(); $file=[IO.File]::Open($env:VITRY_ENV,[IO.FileMode]::CreateNew); try{$out=[Text.Encoding]::ASCII.GetBytes(($lines -join [Environment]::NewLine)+[Environment]::NewLine); $file.Write($out,0,$out.Length)}finally{$file.Dispose()}"
  if errorlevel 1 goto :failed
)
findstr /B /C:"VITRY_LOCAL_REVALIDATE=" "%VITRY_ENV%" >nul
if errorlevel 1 (
  powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $rng=[Security.Cryptography.RandomNumberGenerator]::Create(); try{$bytes=New-Object byte[] 48; $rng.GetBytes($bytes); $line='VITRY_LOCAL_REVALIDATE='+[BitConverter]::ToString($bytes).Replace('-',''); [IO.File]::AppendAllText($env:VITRY_ENV,[Environment]::NewLine+$line+[Environment]::NewLine,[Text.Encoding]::ASCII)}finally{$rng.Dispose()}"
  if errorlevel 1 goto :failed
)
echo [3/4] Iniciando PostgreSQL, armazenamento de imagens, API e painel.
docker compose -p "%VITRY_LOCAL_PROJECT%" --env-file "%VITRY_ENV%" -f "%COMPOSE_FILE%" up -d --build
if errorlevel 1 goto :logs
echo [4/4] Verificando API, banco e tela de login...
powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $end=(Get-Date).AddMinutes(4); $api='http://127.0.0.1:'+$env:VITRY_LOCAL_API_PORT; $web='http://127.0.0.1:'+$env:VITRY_LOCAL_WEB_PORT; do {try {$health=Invoke-RestMethod ($api+'/health') -TimeoutSec 10; $login=Invoke-WebRequest -UseBasicParsing ($web+'/login') -TimeoutSec 45; if($health.status -eq 'ok' -and $login.StatusCode -eq 200){exit 0}} catch {$lastError=$_.Exception.Message}; Start-Sleep -Seconds 2} while((Get-Date) -lt $end); Write-Host $lastError; exit 1"
if errorlevel 1 goto :logs
echo.
echo Painel:   http://127.0.0.1:%VITRY_LOCAL_WEB_PORT%/login
echo Cardapio: http://127.0.0.1:%VITRY_LOCAL_WEB_PORT%/loja/ramenku
if not defined VITRY_LOCAL_NO_BROWSER start "" "http://127.0.0.1:%VITRY_LOCAL_WEB_PORT%/login"
powershell.exe -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; $api='http://127.0.0.1:'+$env:VITRY_LOCAL_API_PORT; $web='http://127.0.0.1:'+$env:VITRY_LOCAL_WEB_PORT; try {$menu=Invoke-RestMethod ($api+'/stores/ramenku/menu') -TimeoutSec 15; $shop=Invoke-WebRequest -UseBasicParsing ($web+'/loja/ramenku') -TimeoutSec 60; if($menu.store.slug -eq 'ramenku' -and $shop.StatusCode -eq 200){exit 0}} catch { Write-Host $_.Exception.Message }; exit 1"
if errorlevel 1 (
  echo O painel abriu. Confira a disponibilidade e o endereco da loja em Minha loja.
) else (
  if not defined VITRY_LOCAL_NO_BROWSER start "" "http://127.0.0.1:%VITRY_LOCAL_WEB_PORT%/loja/ramenku"
)
exit /b 0

:stop
if not exist "%VITRY_ENV%" exit /b 0
docker compose -p "%VITRY_LOCAL_PROJECT%" --env-file "%VITRY_ENV%" -f "%COMPOSE_FILE%" stop
exit /b %errorlevel%

:no_docker
echo Para abrir o sistema completo, instale ou inicie o Docker Desktop com Docker Compose.
echo https://www.docker.com/products/docker-desktop/
goto :failed

:logs
docker compose -p "%VITRY_LOCAL_PROJECT%" --env-file "%VITRY_ENV%" -f "%COMPOSE_FILE%" logs --tail 25 init s3mock api web
:failed
exit /b 1

:reportar_erro
echo.
echo O VitryNow nao iniciou. Detalhes em "%VITRY_LOG%".
if defined VITRY_LOCAL_NO_PAUSE exit /b 1
if exist "%VITRY_LOG%" start "" notepad.exe "%VITRY_LOG%"
echo O registro continuara disponivel depois de fechar esta janela.
echo Pressione Enter para fechar.
set /p "VITRY_FECHAR="
exit /b 1
