; Instalador do print-client (MeuCardapio - placeholder de marca) via Inno Setup 6.
; Compilar: .\tools\build-installer.ps1  (compila o EXE, roda o instalador e confere identidade e hashes)
; Gera bin\Installer\MeuCardapio-PrintClient-Setup.exe
;
; Nome/marca final: decisao do Claudio (CL-05). Troque AppName/AppPublisher/icone so quando ela sair.
; Nada aqui vem de um servico de terceiro: tools\scan-identity.ps1 confere isso no EXE, no instalador e no codigo.
; Assinatura de codigo (Authenticode) so com build final e aval do Claudio (gasto): PC-13.

#define AppVersion "1.0.0"
#define AppExeName "MeuCardapio - Impressao.exe"

[Setup]
AppId={{E1F8B6A0-7C2D-4B3E-9A1F-0C2D4E6F8A9B}
AppName=MeuCardapio - Impressão
AppVersion={#AppVersion}
AppPublisher=MeuCardapio
VersionInfoVersion={#AppVersion}.0
VersionInfoDescription=Instalador do MeuCardapio - Impressão
VersionInfoProductName=MeuCardapio - Impressão
DefaultDirName={autopf}\MeuCardapio\PrintClient
DefaultGroupName=MeuCardapio
OutputBaseFilename=MeuCardapio-PrintClient-Setup
OutputDir=bin\Installer
Compression=lzma
SolidCompression=yes
SetupIconFile=Resources\icon.ico
UninstallDisplayIcon={app}\{#AppExeName}
PrivilegesRequired=lowest
; Mesmo mutex do aplicativo (Services\SingleInstance.cs): o instalador pede para fechar o app aberto antes de
; atualizar e nao sobrescreve um EXE em uso. Nao reabre sozinho (a cozinha escolhe a hora).
AppMutex=Global\MeuCardapioPrintClient-7C2D4B3E
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
Source: "bin\Release\MeuCardapio - Impressao.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "bin\Release\*.dll"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
; Dados do lojista (settings.json com a chave protegida, printed.json, logs) ficam em %LOCALAPPDATA%\MeuCardapioPrintClient
; e NAO sao apagados pela desinstalacao nem pela atualizacao.

[Tasks]
Name: "autostart"; Description: "Iniciar automaticamente com o Windows"; GroupDescription: "Opções adicionais:"; Flags: checkedonce

[Icons]
Name: "{group}\MeuCardapio - Impressão"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Desinstalar MeuCardapio - Impressão"; Filename: "{uninstallexe}"
Name: "{userstartup}\MeuCardapio - Impressão"; Filename: "{app}\{#AppExeName}"; Parameters: "/autostart"; Tasks: autostart

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Abrir o MeuCardapio - Impressão agora"; Flags: nowait postinstall skipifsilent
