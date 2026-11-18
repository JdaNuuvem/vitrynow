using System;
using System.Drawing;
using System.Net.Http;
using System.Threading.Tasks;
using System.Windows.Forms;
using MeuCardapio.PrintClient.Services;

namespace MeuCardapio.PrintClient.UI
{
    // Primeira tela: o lojista cola a URL da API e a "chave de impressora" (device token)
    // geradas no painel web da plataforma. Não há login com e-mail e senha.
    public class SetupForm : Form
    {
        readonly TextBox _apiUrl = new TextBox { Width = 320 };
        // Máscara: a chave nunca aparece na tela (nem a digitada, nem a já salva).
        readonly TextBox _token = new TextBox { Width = 320, UseSystemPasswordChar = true };
        readonly Label _status = new Label { AutoSize = true, ForeColor = Color.DarkRed, MaximumSize = new Size(320, 0) };
        readonly Button _connectBtn = new Button { Text = "Conectar", Width = 100 };

        public SetupForm()
        {
            Text = "MeuCardapio - Configuração inicial";
            ClientSize = new Size(360, 220);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;

            var l1 = new Label { Text = "URL da API (ex.: https://api.meusite.com):", AutoSize = true, Location = new Point(16, 16) };
            _apiUrl.Location = new Point(16, 36);
            _apiUrl.Text = AppSettings.Current.ApiBaseUrl;

            var l2 = new Label { Text = "Chave de impressora (gerada no painel):", AutoSize = true, Location = new Point(16, 70) };
            _token.Location = new Point(16, 90);
            // Não preenche o valor salvo: só indica que existe. Em branco = manter a chave atual.
            bool hasToken = !string.IsNullOrEmpty(AppSettings.Current.DeviceToken);
            if (hasToken) l2.Text = "Chave de impressora (já configurada; deixe em branco para manter):";

            _connectBtn.Location = new Point(16, 130);
            _connectBtn.Click += OnConnectClick;
            _status.Location = new Point(16, 165);

            Controls.AddRange(new Control[] { l1, _apiUrl, l2, _token, _connectBtn, _status });
        }

        async void OnConnectClick(object sender, EventArgs e)
        {
            _status.ForeColor = Color.DarkRed;
            _status.Text = "Verificando...";
            _connectBtn.Enabled = false;

            string apiUrl = _apiUrl.Text.Trim().TrimEnd('/');
            string token = _token.Text.Trim();
            if (string.IsNullOrEmpty(token)) token = AppSettings.Current.DeviceToken ?? "";

            string urlProblem = ApiUrlPolicy.Validate(apiUrl);
            if (urlProblem != null)
            {
                _status.Text = urlProblem;
                _connectBtn.Enabled = true;
                return;
            }
            if (string.IsNullOrEmpty(token))
            {
                _status.Text = "Informe a chave de impressora.";
                _connectBtn.Enabled = true;
                return;
            }

            try
            {
                // Sem redirecionamento (o Bearer nunca sai para outro host) e com timeout de 15 s.
                using (var handler = new HttpClientHandler { AllowAutoRedirect = false })
                using (var http = new HttpClient(handler) { BaseAddress = new Uri(apiUrl), Timeout = DeviceClient.HttpTimeout })
                {
                    http.DefaultRequestHeaders.Authorization =
                        new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
                    var response = await http.GetAsync("/api/device/orders/pending");
                    if (!response.IsSuccessStatusCode)
                    {
                        _status.Text = "Não autorizado. Confira a URL e a chave.";
                        _connectBtn.Enabled = true;
                        return;
                    }
                }

                AppSettings.Current.ApiBaseUrl = apiUrl;
                AppSettings.Current.DeviceToken = token;
                if (!AppSettings.Save())
                {
                    _status.Text = "Conectou, mas não foi possível salvar a configuração neste computador. Verifique as permissões da pasta do aplicativo.";
                    _connectBtn.Enabled = true;
                    return;
                }

                DialogResult = DialogResult.OK;
                Close();
            }
            catch (Exception ex)
            {
                _status.Text = "Falha ao conectar: " + ex.Message;
                _connectBtn.Enabled = true;
            }
        }
    }
}
