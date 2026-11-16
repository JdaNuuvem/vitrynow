using System;

namespace MeuCardapio.PrintClient.Services
{
    // Política da URL da API (parecer Nightingale C1): a chave de impressora viaja como Bearer,
    // então só pode ir em claro (http://) para a própria máquina. Qualquer outro host exige
    // https:// (e, no WebSocket, wss://).
    public static class ApiUrlPolicy
    {
        // Devolve null se a URL é aceita; senão, a mensagem para o usuário.
        public static string Validate(string url)
        {
            if (string.IsNullOrWhiteSpace(url)) return "Informe a URL da API.";
            Uri uri;
            if (!Uri.TryCreate(url.Trim(), UriKind.Absolute, out uri)) return "A URL da API não é válida.";
            if (!string.IsNullOrEmpty(uri.UserInfo)) return "A URL da API não pode conter usuário e senha.";

            if (uri.Scheme == Uri.UriSchemeHttps) return null;
            if (uri.Scheme == Uri.UriSchemeHttp)
            {
                if (uri.IsLoopback) return null; // localhost, 127.0.0.1, ::1
                return "Use https:// para servidores fora deste computador. A chave de impressora não pode ir sem criptografia.";
            }
            return "A URL da API deve começar com https:// (ou http:// só para localhost).";
        }

        public static bool IsAllowed(string url) { return Validate(url) == null; }
    }
}
