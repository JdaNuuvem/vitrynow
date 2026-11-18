using System;
using System.Security.Cryptography;
using System.Text;

namespace MeuCardapio.PrintClient.Services
{
    // Protege segredos locais com DPAPI (escopo do usuário do Windows). O texto cifrado só abre
    // na mesma conta de usuário e no mesmo computador: copiar o settings.json para outra
    // máquina não vaza a chave de impressora (B06 / R12).
    public static class SecretStore
    {
        static readonly byte[] Entropy = Encoding.UTF8.GetBytes("MeuCardapio.PrintClient.v1");

        // Devolve base64 do valor cifrado. Vazio vira vazio.
        public static string Protect(string plain)
        {
            if (string.IsNullOrEmpty(plain)) return "";
            var raw = ProtectedData.Protect(Encoding.UTF8.GetBytes(plain), Entropy, DataProtectionScope.CurrentUser);
            return Convert.ToBase64String(raw);
        }

        // Devolve o texto original, ou "" se não for possível abrir (outro usuário/máquina,
        // dado corrompido). Quem chama trata "" como "não configurado" e pede a chave de novo.
        public static string Unprotect(string protectedBase64)
        {
            if (string.IsNullOrEmpty(protectedBase64)) return "";
            try
            {
                var raw = ProtectedData.Unprotect(Convert.FromBase64String(protectedBase64), Entropy, DataProtectionScope.CurrentUser);
                return Encoding.UTF8.GetString(raw);
            }
            catch (Exception) { return ""; }
        }
    }
}
