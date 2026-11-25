; Instalador do Vitry Impressão (print-client) via Inno Setup 6.
; Compilar: .\tools\build-installer.ps1  (compila o EXE, assina se houver certificado, roda o instalador e confere identidade e hashes)
; Gera bin\Installer\Vitry-Impressao-Setup.exe
;
; Marca "Vitry" (CL-05). O que NÃO muda com a marca, para a atualização reconhecer quem já tem o antigo "MeuCardapio - Impressão":
;   AppId (abaixo), AppMutex (= Services\SingleInstance.cs) e a pasta de dados %LOCALAPPDATA%\MeuCardapioPrintClient.
; Nada aqui vem de um serviço de terceiro: tools\scan-identity.ps1 confere isso no EXE, no instalador e no código.
; Assinatura de código (Authenticode, PC-13): tools\sign-code.ps1, chamado pelo build-installer.ps1 quando há certificado.

#define AppVersion "1.0.0"
#define AppExeName "Vitry Impressao.exe"
#define AppTitle "Vitry Impressão"
#define OldExeName "MeuCardapio - Impressao.exe"
#define OldTitle "MeuCardapio - Impressão"

[Setup]
AppId={{E1F8B6A0-7C2D-4B3E-9A1F-0C2D4E6F8A9B}
AppName={#AppTitle}
AppVersion={#AppVersion}
AppPublisher=Vitry
VersionInfoVersion={#AppVersion}.0
VersionInfoDescription=Instalador do {#AppTitle}
VersionInfoProductName={#AppTitle}
VersionInfoCompany=Vitry
; Instalação nova vai para Vitry\Impressao; quem já tem o antigo continua na MESMA pasta (UsePreviousAppDir, pelo AppId).
DefaultDirName={autopf}\Vitry\Impressao
UsePreviousAppDir=yes
DefaultGroupName=Vitry
OutputBaseFilename=Vitry-Impressao-Setup
OutputDir=bin\Installer
Compression=lzma
SolidCompression=yes
SetupIconFile=Resources\icon.ico
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppTitle}
PrivilegesRequired=lowest
; Mesmo mutex do aplicativo (Services\SingleInstance.cs): o instalador pede para fechar o app aberto antes de
; atualizar e não sobrescreve um EXE em uso. Não reabre sozinho (a cozinha escolhe a hora).
AppMutex=Global\MeuCardapioPrintClient-7C2D4B3E
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[InstallDelete]
; Atualização a partir do nome antigo: remove o EXE e os atalhos com o nome antigo (senão o atalho de inicialização
; antigo abriria um EXE que não existe mais, ou dois atalhos no menu Iniciar).
Type: files; Name: "{app}\{#OldExeName}"
Type: files; Name: "{userstartup}\{#OldTitle}.lnk"
Type: files; Name: "{userprograms}\MeuCardapio\{#OldTitle}.lnk"
Type: files; Name: "{userprograms}\MeuCardapio\Desinstalar {#OldTitle}.lnk"
Type: dirifempty; Name: "{userprograms}\MeuCardapio"

[Files]
Source: "bin\Release\{#AppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "bin\Release\*.dll"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
; Dados do lojista (settings.json com a chave protegida, printed.json, logs) ficam em %LOCALAPPDATA%\MeuCardapioPrintClient
; e NÃO são apagados pela desinstalação nem pela atualização.

[Tasks]
Name: "autostart"; Description: "Iniciar automaticamente com o Windows"; GroupDescription: "Opções adicionais:"; Flags: checkedonce

[Icons]
Name: "{group}\{#AppTitle}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Desinstalar {#AppTitle}"; Filename: "{uninstallexe}"
Name: "{userstartup}\{#AppTitle}"; Filename: "{app}\{#AppExeName}"; Parameters: "/autostart"; Tasks: autostart

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Abrir o {#AppTitle} agora"; Flags: nowait postinstall skipifsilent
