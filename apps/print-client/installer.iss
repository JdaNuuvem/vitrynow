; Instalador do print-client (MeuCardapio — placeholder de marca) via Inno Setup.
; Compilar: ISCC.exe installer.iss  (requer Inno Setup 6 instalado: https://jrsoftware.org/isinfo.php)
; Gera bin\Installer\MeuCardapio-PrintClient-Setup.exe
;
; Troque AppName/AppPublisher/ícone quando a marca final for decidida — nada aqui aponta
; para cardapio.ai: é o instalador do NOSSO app, assinado com o NOSSO nome.

#define AppVersion "1.0.0"
#define AppExeName "MeuCardapio - Impressao.exe"

[Setup]
AppId={{E1F8B6A0-7C2D-4B3E-9A1F-0C2D4E6F8A9B}
AppName=MeuCardapio - Impressão
AppVersion={#AppVersion}
AppPublisher=MeuCardapio
DefaultDirName={autopf}\MeuCardapio\PrintClient
DefaultGroupName=MeuCardapio
OutputBaseFilename=MeuCardapio-PrintClient-Setup
OutputDir=bin\Installer
Compression=lzma
SolidCompression=yes
SetupIconFile=Resources\icon.ico
UninstallDisplayIcon={app}\{#AppExeName}
PrivilegesRequired=lowest

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
Source: "bin\Release\MeuCardapio - Impressao.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "bin\Release\*.dll"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

[Tasks]
Name: "autostart"; Description: "Iniciar automaticamente com o Windows"; GroupDescription: "Opções adicionais:"; Flags: checkedonce

[Icons]
Name: "{group}\MeuCardapio - Impressão"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Desinstalar MeuCardapio - Impressão"; Filename: "{uninstallexe}"
Name: "{userstartup}\MeuCardapio - Impressão"; Filename: "{app}\{#AppExeName}"; Parameters: "/autostart"; Tasks: autostart

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Abrir o MeuCardapio - Impressão agora"; Flags: nowait postinstall skipifsilent
