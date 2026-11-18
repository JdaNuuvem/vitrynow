using System;

namespace MeuCardapio.PrintClient.Services
{
    // Motivo de falha de impressão que SAI do computador da loja (ADR-0004 §8 item 8, parecer Nightingale PC-03).
    // A mensagem detalhada de uma exceção (.NET, driver, spooler) pode trazer o nome da impressora ou do compartilhamento
    // ("\\SERVIDOR\HP-Joao"), caminho ou usuário do Windows: isso fica SÓ no log local. Ao servidor vai um CÓDIGO de lista
    // fechada e uma frase fixa nossa, em português, sem dado do computador.
    public static class PrintFailure
    {
        public const string PrinterOffline = "PRINTER_OFFLINE";
        public const string NoPaper = "NO_PAPER";
        public const string DriverError = "DRIVER_ERROR";
        public const string PrinterNotFound = "PRINTER_NOT_FOUND";
        public const string Other = "OTHER";

        public static readonly string[] All = { PrinterOffline, NoPaper, DriverError, PrinterNotFound, Other };

        // Qualquer coisa fora da lista vira OTHER (nunca ecoa texto de terceiros).
        public static string Normalize(string code)
        {
            var c = (code ?? "").Trim().ToUpperInvariant();
            return Array.IndexOf(All, c) >= 0 ? c : Other;
        }

        // Frase fixa (nossa) para o código. O servidor também mostra a sua própria tradução do código.
        public static string Phrase(string code)
        {
            switch (Normalize(code))
            {
                case PrinterOffline: return "impressora offline";
                case NoPaper: return "impressora sem papel";
                case DriverError: return "erro do driver da impressora";
                case PrinterNotFound: return "impressora não encontrada";
                default: return "falha na impressão";
            }
        }
    }
}
