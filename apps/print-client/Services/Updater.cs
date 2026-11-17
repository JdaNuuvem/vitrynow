using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;

namespace MeuCardapio.PrintClient.Services
{
    // Unconfirmed: o manifesto é autêntico mas venceu (ou o relógio do PC está muito errado): não instala
    // nada, não bloqueia a impressão e pede para tentar de novo / acertar o relógio.
    public enum UpdateOutcome { NotConfigured, UpToDate, Failed, Rejected, Unconfirmed, Ready }

    public sealed class UpdateResult
    {
        public UpdateOutcome Outcome;
        public string Message;
        public string Version;
        public string InstallerPath; // só em Ready: arquivo JÁ verificado
        public string ExpectedSha256; // do manifesto assinado (só em Ready)
        public long ExpectedSize;
        // A versão atual é menor que a minVersion do manifesto assinado: o app avisa que precisa atualizar.
        public bool Required;
    }

    // Auto-update seguro (PC-04, B17). Servidor NOSSO, em {UpdateBaseUrl}:
    //   latest.json + latest.json.sig + <file do manifesto>
    // Regras: https obrigatório (http só em localhost); manifesto com assinatura RSA válida contra uma das
    // chaves embutidas (UpdateKeys, escolhida pelo keyId do manifesto; chave revogada = recusa);
    // versão estritamente maior que a atual; issuedAt nunca menor que o último aceito (anti-replay);
    // manifesto vencido = "não consegui confirmar" (sem bloquear a impressão); minVersion sinaliza obrigatória;
    // instalador baixado numa pasta privada do usuário, com tamanho e SHA-256 do manifesto
    // conferidos ANTES de qualquer execução; nada é executado se algo falhar. Sem chave de release
    // provisionada, recusa tudo (fecha por padrão).
    public static class Updater
    {
        // Versão do app = versão do assembly (Properties\AssemblyInfo.cs), sem o 4º número ("1.0.0").
        public static readonly string CurrentVersion = ReadVersion();

        static string ReadVersion()
        {
            var v = typeof(Updater).Assembly.GetName().Version;
            return v == null ? "0.0.0" : v.Major + "." + v.Minor + "." + Math.Max(0, v.Build);
        }
        public static event Action<string> StatusChanged;

        public static bool IsConfigured => !string.IsNullOrWhiteSpace(AppSettings.Current.UpdateBaseUrl);

        public static string UpdatesDirectory => Path.Combine(AppSettings.BaseDirectory, "updates");

        public static string StatePath => Path.Combine(AppSettings.BaseDirectory, "update-state.json");

        static int _running;
        static readonly object _pendingLock = new object();
        static UpdateResult _pending;

        // Atualização já baixada e VERIFICADA, esperando o lojista aceitar (PC-13: nunca instala sozinha, porque o
        // instalador fecha o app no meio do expediente e pode interromper a impressão no horário de pico).
        // K3: só devolve a pendência se o arquivo AINDA existe. Uma verificação posterior limpa a pasta de updates (e apaga o
        // instalador pendente); se o download dessa verificação falhar, a pendência ficaria apontando para o nada.
        public static UpdateResult Pending
        {
            get
            {
                lock (_pendingLock)
                {
                    if (_pending != null && !File.Exists(_pending.InstallerPath)) { _lostPending = _pending.Version; _pending = null; }
                    return _pending;
                }
            }
        }

        static string _lostPending;
        public const string PendingLostMessage = "A atualização preparada não está mais no disco (uma verificação posterior a substituiu ou o arquivo foi apagado). Use \"Verificar atualizações\" para prepará-la de novo.";

        // Avisa a tela: há atualização pronta (Required = versão mínima: texto mais forte, mas ainda pede confirmação).
        public static event Action<UpdateResult> UpdateReady;

        // A atualização que estava pronta sumiu do disco (K3): a tela esconde "Instalar atualização" e mostra o motivo.
        public static event Action PendingLost;

        // Só verifica e prepara (baixa e confere hash/assinatura). NÃO executa nada.
        public static void CheckForUpdate()
        {
            // Duas verificações ao mesmo tempo (início + menu) usariam a mesma pasta: só uma roda.
            if (System.Threading.Interlocked.Exchange(ref _running, 1) == 1) return;
            try
            {
                var r = Evaluate(AppSettings.Current.UpdateBaseUrl, CurrentVersion, UpdateKeys.Trusted,
                    new HttpUpdateTransport(), UpdatesDirectory, StatePath);
                if (r.Outcome == UpdateOutcome.Rejected) Logger.Error("Atualização recusada: " + r.Message);
                else Logger.Info("Atualização: " + r.Outcome + " — " + r.Message);
                StatusChanged?.Invoke(r.Message);
                if (Stage(r)) UpdateReady?.Invoke(r);
                else if (Pending == null && _lostPending != null) { StatusChanged?.Invoke(PendingLostMessage); PendingLost?.Invoke(); }
            }
            finally { System.Threading.Interlocked.Exchange(ref _running, 0); }
        }

        // Guarda o resultado como "pronto para instalar" se for Ready (a versão mais nova substitui a anterior).
        public static bool Stage(UpdateResult r)
        {
            if (r == null || r.Outcome != UpdateOutcome.Ready) return false;
            lock (_pendingLock)
            {
                if (_pending != null && UpdateVerifier.CompareVersions(_pending.Version, r.Version) > 0) return false;
                _pending = r;
            }
            return true;
        }

        // Chamado SÓ depois do "sim" do lojista. Reverifica o arquivo (tamanho + SHA-256 do manifesto assinado) pelo handle
        // aberto e só então inicia o instalador (parecer U1). Devolve se iniciou; a pendência sai ao iniciar.
        public static bool InstallPending(Action<string> start, Action<string> status)
        {
            var r = Pending; // valida o arquivo (K3)
            if (r == null)
            {
                string lost; lock (_pendingLock) { lost = _lostPending; _lostPending = null; }
                status?.Invoke(lost != null ? PendingLostMessage : "Nenhuma atualização pronta para instalar.");
                return false;
            }
            bool started = TryLaunch(r, start, status);
            if (started) lock (_pendingLock) { if (ReferenceEquals(_pending, r)) _pending = null; }
            return started;
        }

        // "Não agora" ou app fechando: o instalador verificado NÃO fica esperando em disco (parecer Nightingale). A próxima
        // abertura ou "Verificar atualizações" baixa e confere de novo, uma vez (não há verificação periódica nem laço).
        public static void DiscardPending()
        {
            UpdateResult r;
            lock (_pendingLock) { r = _pending; _pending = null; }
            if (r != null) TryDelete(r.InstallerPath);
        }

        // Para os testes.
        internal static void ClearPending() { lock (_pendingLock) { _pending = null; _lostPending = null; } }

        // Toda a decisão, sem executar nada (testável com transporte falso e relógio injetado).
        public static UpdateResult Evaluate(string baseUrl, string currentVersion, IList<TrustedKey> keys,
            IUpdateTransport transport, string updatesDir, string statePath = null, Func<DateTime> utcNow = null)
        {
            if (string.IsNullOrWhiteSpace(baseUrl))
                return Res(UpdateOutcome.NotConfigured, "Auto-update não configurado.");
            var urlError = UpdateVerifier.ValidateBaseUrl(baseUrl);
            if (urlError != null) return Res(UpdateOutcome.Rejected, urlError);
            if (keys == null || !keys.Any(k => k != null && !string.IsNullOrWhiteSpace(k.PublicKeyXml)))
                return Res(UpdateOutcome.Rejected, "Auto-update desligado: chave de assinatura de release não provisionada neste build.");
            var now = (utcNow ?? (() => DateTime.UtcNow))();

            var root = new Uri(baseUrl.Trim().TrimEnd('/') + "/");
            byte[] manifestBytes, sigBytes;
            try
            {
                manifestBytes = transport.GetSmall(new Uri(root, "latest.json"), UpdateVerifier.MaxManifestBytes);
                sigBytes = transport.GetSmall(new Uri(root, "latest.json.sig"), 4096);
            }
            catch (Exception ex) { return Res(UpdateOutcome.Failed, "Não foi possível verificar atualização: " + ex.Message); }

            // 1) forma do manifesto (só leitura, sem efeito) -> escolhe a chave pelo keyId -> confere a assinatura
            string err;
            var m = UpdateVerifier.ParseManifest(manifestBytes, out err);
            if (m == null) return Res(UpdateOutcome.Rejected, "Manifesto de atualização inválido: " + err);

            var state = statePath == null ? new UpdateState() : UpdateState.Load(statePath);
            if (state.RevokedKeys.Contains(m.KeyId))
                return Res(UpdateOutcome.Rejected, "Manifesto assinado por uma chave revogada (" + m.KeyId + "). Nada foi baixado.");
            int keyIndex = -1;
            for (int i = 0; i < keys.Count; i++) if (keys[i] != null && keys[i].KeyId == m.KeyId) { keyIndex = i; break; }
            if (keyIndex < 0 || string.IsNullOrWhiteSpace(keys[keyIndex].PublicKeyXml))
                return Res(UpdateOutcome.Rejected, "Manifesto assinado por uma chave desconhecida (" + m.KeyId + ").");
            var sig = Encoding.ASCII.GetString(sigBytes ?? new byte[0]);
            if (!UpdateVerifier.VerifySignature(manifestBytes, sig, keys[keyIndex].PublicKeyXml))
                return Res(UpdateOutcome.Rejected, "Assinatura do manifesto de atualização inválida. Nada foi baixado.");

            // 2) a partir daqui o manifesto é AUTÊNTICO. Revogação: só de chaves anteriores na lista.
            if (m.RevokeKeys != null)
            {
                foreach (var rk in m.RevokeKeys)
                {
                    int ri = -1;
                    for (int i = 0; i < keys.Count; i++) if (keys[i] != null && keys[i].KeyId == rk) { ri = i; break; }
                    if (ri < 0 || ri >= keyIndex)
                        return Res(UpdateOutcome.Rejected, "Revogação não permitida: a chave " + m.KeyId + " só revoga chaves anteriores da lista.");
                }
            }
            // Anti-replay: não aceita manifesto mais antigo que o último já aceito (mesmo assinado e válido).
            if (state.MaxIssuedAtUtc.HasValue && m.IssuedAtUtc < state.MaxIssuedAtUtc.Value)
                return Res(UpdateOutcome.Rejected, "Manifesto mais antigo que o último aceito (reenvio de versão antiga). Ignorado.");
            // Frescor: janela generosa; vencido/relógio errado = "não consegui confirmar", sem bloquear a impressão.
            if (now > m.ValidUntilUtc)
                return Res(UpdateOutcome.Unconfirmed, "Não consegui confirmar atualizações: o manifesto publicado venceu em " + m.ValidUntilUtc.ToString("yyyy-MM-dd") + ". Confira o relógio do computador ou tente mais tarde.");
            if (now < m.IssuedAtUtc - UpdateVerifier.ClockTolerance)
                return Res(UpdateOutcome.Unconfirmed, "Não consegui confirmar atualizações: o relógio do computador parece atrasado. Acerte data e hora.");

            // Aceito: grava o que aprendeu (maior issuedAt e chaves revogadas) mesmo que não haja versão nova.
            if (statePath != null)
            {
                state.MaxIssuedAtUtc = m.IssuedAtUtc;
                if (m.RevokeKeys != null) foreach (var rk in m.RevokeKeys) if (!state.RevokedKeys.Contains(rk)) state.RevokedKeys.Add(rk);
                state.Save(statePath);
            }

            int cmp = UpdateVerifier.CompareVersions(m.Version, currentVersion);
            if (cmp == -2) return Res(UpdateOutcome.Rejected, "Versão do manifesto ou do app inválida.");
            bool required = m.MinVersion != null && UpdateVerifier.CompareVersions(currentVersion, m.MinVersion) < 0;
            if (cmp <= 0) return Res(UpdateOutcome.UpToDate, "Você já está na versão mais recente (" + currentVersion + ").");

            string part = null;
            try
            {
                Directory.CreateDirectory(updatesDir);
                Cleanup(updatesDir);
                part = Path.Combine(updatesDir, Guid.NewGuid().ToString("N") + ".part");
                transport.Download(new Uri(root, Uri.EscapeDataString(m.File)), part, m.Size);
                if (!UpdateVerifier.VerifyFile(part, m))
                {
                    TryDelete(part);
                    return Res(UpdateOutcome.Rejected, "O instalador baixado não confere com o hash assinado. Descartado, nada foi executado.");
                }
                var final = Path.Combine(updatesDir, m.File);
                File.Move(part, final);
                return new UpdateResult { Outcome = UpdateOutcome.Ready, Version = m.Version, InstallerPath = final,
                    ExpectedSha256 = m.Sha256, ExpectedSize = m.Size, Required = required,
                    Message = (required ? "Atualização obrigatória " : "Atualização ") + m.Version + " verificada." };
            }
            catch (Exception ex)
            {
                TryDelete(part);
                var r = Res(UpdateOutcome.Failed, "Falha ao baixar a atualização: " + ex.Message);
                r.Required = required;
                if (required) r.Message += " Esta versão do app não é mais suportada; atualize assim que possível.";
                return r;
            }
        }

        // Reverifica tamanho + SHA-256 do arquivo final contra o manifesto assinado, lendo pelo MESMO
        // handle que fica aberto (FileShare.Read) enquanto `start` roda: não dá para trocar o arquivo
        // entre a conferência e a execução. `start` só é chamado se tudo conferir. Devolve se iniciou.
        public static bool TryLaunch(UpdateResult r, Action<string> start, Action<string> status)
        {
            if (r == null || r.Outcome != UpdateOutcome.Ready || string.IsNullOrEmpty(r.InstallerPath)) return false;
            bool mismatch = false;
            try
            {
                using (var fs = new FileStream(r.InstallerPath, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    string hash = null;
                    if (fs.Length == r.ExpectedSize)
                    {
                        using (var sha = System.Security.Cryptography.SHA256.Create())
                        {
                            var h = sha.ComputeHash(fs);
                            var sb = new StringBuilder(h.Length * 2);
                            foreach (var x in h) sb.Append(x.ToString("X2"));
                            hash = sb.ToString();
                        }
                    }
                    if (hash == null || !string.Equals(hash, r.ExpectedSha256, StringComparison.OrdinalIgnoreCase)) mismatch = true;
                    else
                    {
                        status?.Invoke("Instalando atualização " + r.Version + "...");
                        start(r.InstallerPath);
                        return true;
                    }
                }
            }
            catch (Exception ex)
            {
                status?.Invoke("Erro ao iniciar o instalador: " + ex.Message);
                return false;
            }
            if (mismatch) Refuse(r, status); // handle já fechado: dá para apagar
            return false;
        }

        static void Refuse(UpdateResult r, Action<string> status)
        {
            try { File.Delete(r.InstallerPath); } catch { }
            status?.Invoke("O instalador mudou depois de verificado. Descartado, nada foi executado.");
        }

        static UpdateResult Res(UpdateOutcome o, string msg) { return new UpdateResult { Outcome = o, Message = msg }; }
        static void TryDelete(string p) { try { if (p != null && File.Exists(p)) File.Delete(p); } catch { } }

        // Instaladores e .part antigos não ficam acumulando.
        static void Cleanup(string dir)
        {
            try { foreach (var f in Directory.GetFiles(dir)) TryDelete(f); } catch { }
        }
    }
}
