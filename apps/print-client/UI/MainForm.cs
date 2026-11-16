using System;
using System.Collections.Generic;
using System.Linq;
using System.Drawing;
using System.Drawing.Printing;
using System.Threading.Tasks;
using System.Windows.Forms;
using MeuCardapio.PrintClient.Models;
using MeuCardapio.PrintClient.Services;

namespace MeuCardapio.PrintClient.UI
{
    // Status dos listeners, combos de impressora/som/volume, toast e tray.
    public class MainForm : Form
    {
        readonly Label _statusLabel = new Label { AutoSize = true, Font = new Font("Segoe UI", 9f) };
        readonly ComboBox _printers = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 200 };
        readonly ComboBox _sounds = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 140 };
        readonly TrackBar _volume = new TrackBar { Minimum = 0, Maximum = 100, TickFrequency = 10, Width = 180 };
        readonly Label _toast = new Label { AutoSize = true, ForeColor = Color.DarkGreen, Location = new Point(16, 190), MaximumSize = new Size(380, 0) };
        readonly NotifyIcon _tray = new NotifyIcon();
        // Indicador fixo (PC-06 d / PC-05): não some como o toast. Vazio = sem problema.
        readonly Label _problemLabel = new Label
        {
            AutoSize = false, Visible = false, ForeColor = Color.White, BackColor = Color.Firebrick,
            Font = new Font("Segoe UI", 9f, FontStyle.Bold), Location = new Point(16, 110), Size = new Size(210, 72), Padding = new Padding(6),
        };
        string _revokedText;
        IList<string> _failedOrders = new List<string>();

        public MainForm()
        {
            Text = "MeuCardapio - Impressão";
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { /* sem ícone embutido no EXE atual */ }
            ClientSize = new Size(420, 230);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;

            var lc1 = new Label { Text = "Impressora:", AutoSize = true, Location = new Point(16, 20) };
            _printers.Location = new Point(16, 40);
            var lc2 = new Label { Text = "Som de alerta:", AutoSize = true, Location = new Point(240, 20) };
            _sounds.Location = new Point(240, 40);
            var lv = new Label { Text = "Volume:", AutoSize = true, Location = new Point(240, 80) };
            _volume.Location = new Point(240, 100);
            _volume.Value = Math.Max(_volume.Minimum, Math.Min(_volume.Maximum, AppSettings.Current.SoundVolume));

            _statusLabel.Text = "Conectando...";
            _statusLabel.Location = new Point(16, 80);

            Controls.AddRange(new Control[] { lc1, _printers, lc2, _sounds, lv, _volume, _statusLabel, _toast, _problemLabel });

            ReloadPrinters();
            _sounds.Items.AddRange(new object[] { "Sino", "Padrão", "Som personalizado..." });
            _sounds.SelectedIndex = Math.Max(0, AppSettings.Current.DropdownIndex - 1);

            _printers.SelectedIndexChanged += OnPrinterChanged;
            _sounds.SelectedIndexChanged += OnSoundChanged;
            _volume.Scroll += OnVolumeChanged;

            WireAppEvents();

            _tray.Icon = Icon ?? SystemIcons.Application;
            _tray.Visible = !App.AutoStart;
            var menu = new ContextMenuStrip();
            menu.Items.Add(App.AutoStart ? "Mostrar" : "Minimizar", null, (s, e) => Show());
            menu.Items.Add("Configurar chave...", null, (s, e) => OpenSetup());
            menu.Items.Add("Verificar atualizações", null, (s, e) => Task.Run(() => Updater.CheckForUpdate()));
            menu.Items.Add("Sair", null, (s, e) => Close());
            _tray.ContextMenuStrip = menu;

            Updater.StatusChanged += text => BeginInvoke(new Action(() => Toast(text)));

            if (App.AutoStart) WindowState = FormWindowState.Minimized;

            Shown += (s, e) =>
            {
                WarnAboutTokenMigration();
                App.StartListeners();
                if (Updater.IsConfigured) Task.Run(() => Updater.CheckForUpdate());
            };
        }

        // Parecer Nightingale (C2): a migração da chave em texto puro precisa ser visível.
        void WarnAboutTokenMigration()
        {
            switch (AppSettings.Current.Migration)
            {
                case TokenMigration.SaveFailed:
                    Logger.Error("Chave de impressora ainda em texto puro em settings.json: não foi possível regravar");
                    _statusLabel.Text = "ATENÇÃO: a chave de impressora ainda não está protegida neste computador.";
                    MessageBox.Show(this,
                        "Não foi possível proteger a chave de impressora neste computador (o arquivo de configuração não pôde ser gravado)." + Environment.NewLine + Environment.NewLine
                        + "Verifique as permissões da pasta " + AppSettings.BaseDirectory + ". O aplicativo tentará de novo na próxima abertura.",
                        "MeuCardapio - Impressão", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    break;
                case TokenMigration.Protected:
                    Logger.Info("Chave de impressora migrada de texto puro para proteção do Windows");
                    MessageBox.Show(this,
                        "A chave de impressora agora fica protegida neste computador." + Environment.NewLine + Environment.NewLine
                        + "Como a chave anterior estava salva em texto puro, gere uma nova chave no painel (Impressoras) e troque-a pelo menu da bandeja (\"Configurar chave...\").",
                        "MeuCardapio - Impressão", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    break;
            }
        }

        void OpenSetup()
        {
            using (var setup = new SetupForm())
            {
                if (setup.ShowDialog(this) == DialogResult.OK)
                {
                    App.Device.RetryNow(); // chave nova vale na hora (se estava pausada, testa já)
                    MessageBox.Show(this, "Configuração salva. A nova chave já está em uso. Se você mudou a URL da API, feche e abra o aplicativo.",
                        "MeuCardapio - Impressão", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            }
        }

        void WireAppEvents()
        {
            App.Device.StatusChanged += text =>
            {
                Logger.Info(text);
                BeginInvoke(new Action(() => { _statusLabel.Text = text; Toast(text); }));
            };
            App.Device.OrderPending += () => BeginInvoke(new Action(OnOrderPending));
            App.Device.PrintProblemsChanged += list => BeginInvoke(new Action(() => ShowPrintProblems(list)));
            App.Device.KeyRevoked += () => BeginInvoke(new Action(ShowKeyRevoked));
            App.Device.KeyRestored += () => BeginInvoke(new Action(() => { _revokedText = null; RefreshProblemLabel(); }));
            App.Coordinator.Message += msg => BeginInvoke(new Action(() => { Toast(msg); Logger.Info(msg); }));
            App.Device.TicketReady += order => BeginInvoke(new Action(() => PrintAndAck(order)));
        }

        // Indicador persistente de pedidos sem imprimir. O balão do ícone só aparece quando a lista
        // CRESCE (pedido novo com problema), nunca a cada tentativa.
        void ShowPrintProblems(IList<string> list)
        {
            bool grew = list.Any(x => !_failedOrders.Contains(x));
            _failedOrders = list;
            RefreshProblemLabel();
            if (grew && _tray.Visible)
                _tray.ShowBalloonTip(8000, "MeuCardapio - Impressão", list.Count + " pedido(s) sem imprimir: " + string.Join(", ", list) + ". Confira papel, cabo e se a impressora está ligada.", ToolTipIcon.Warning);
            _tray.Text = list.Count == 0 ? "MeuCardapio - Impressão" : "MeuCardapio: " + list.Count + " pedido(s) SEM IMPRIMIR";
        }

        void ShowKeyRevoked()
        {
            _revokedText = "CHAVE DE IMPRESSORA RECUSADA. A impressão está PAUSADA. Gere uma chave nova no painel e use \"Configurar chave...\" na bandeja. O app volta sozinho quando a chave valer.";
            RefreshProblemLabel();
            if (_tray.Visible) _tray.ShowBalloonTip(10000, "MeuCardapio - Impressão", "Chave de impressora revogada: impressão pausada.", ToolTipIcon.Error);
        }

        void RefreshProblemLabel()
        {
            if (_revokedText != null) { _problemLabel.Text = _revokedText; _problemLabel.Visible = true; return; }
            _problemLabel.Visible = _failedOrders.Count > 0;
            if (_failedOrders.Count > 0)
                _problemLabel.Text = "⚠ " + _failedOrders.Count + " pedido(s) SEM IMPRIMIR: " + string.Join(", ", _failedOrders.Take(6)) + (_failedOrders.Count > 6 ? "…" : "")
                    + Environment.NewLine + "Confira papel, cabo e se a impressora está ligada.";
        }

        void OnOrderPending()
        {
            if (!AppSettings.Current.ReceiveAlerts) return;
            using (var n = new NotifyForm()) n.Show();
            App.Audio.Play(AppSettings.Current.DropdownIndex, AppSettings.Current.CustomSound, AppSettings.Current.SoundVolume);
        }

        void PrintAndAck(PrintableOrder order)
        {
            // Tudo (montar, imprimir, gravar no ledger, avisar a API) está em PrintCoordinator, testado sem tela.
            App.Coordinator.Handle(order);
        }

        void ReloadPrinters()
        {
            var prev = AppSettings.Current.SelectedPrinter;
            _printers.Items.Clear();
            var col = PrinterSettings.InstalledPrinters;
            var names = new string[col.Count];
            for (int p = 0; p < col.Count; p++) names[p] = col[p];
            _printers.Items.AddRange(names);
            int idx = !string.IsNullOrEmpty(prev) ? Array.IndexOf(names, prev) : -1;
            _printers.SelectedIndex = idx >= 0 ? idx : (names.Length > 0 ? 0 : -1);
        }

        void OnPrinterChanged(object sender, EventArgs e)
        {
            AppSettings.Current.DropdownPrintIndex = _printers.SelectedIndex;
            AppSettings.Current.SelectedPrinter = _printers.SelectedItem as string ?? "";
            AppSettings.Save();
            App.Printer.SelectPrinter(_printers.SelectedIndex);
            Toast("Impressora: " + AppSettings.Current.SelectedPrinter);
        }

        void OnSoundChanged(object sender, EventArgs e)
        {
            AppSettings.Current.DropdownIndex = _sounds.SelectedIndex + 1;
            if (_sounds.SelectedIndex == 2)
            {
                using (var ofd = new OpenFileDialog { Title = "Som personalizado", Filter = "Áudio|*.wav;*.mp3;*.wma" })
                {
                    if (ofd.ShowDialog(this) == DialogResult.OK)
                        AppSettings.Current.CustomSound = ofd.FileName;
                }
            }
            AppSettings.Save();
            App.Audio.Play(AppSettings.Current.DropdownIndex, AppSettings.Current.CustomSound, _volume.Value);
        }

        void OnVolumeChanged(object sender, EventArgs e)
        {
            AppSettings.Current.SoundVolume = _volume.Value;
            AppSettings.Save();
        }

        void Toast(string msg) => _toast.Text = msg;

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!App.AutoStart && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
                _tray.Visible = true;
                return;
            }
            App.Shutdown();
            _tray.Visible = false;
            base.OnFormClosing(e);
        }
    }
}
