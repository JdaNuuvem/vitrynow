using System;

namespace MeuCardapio.PrintClient.Printing
{
    // Falha PREVISÍVEL da impressora (offline, sem papel, sem seleção, cabo solto): o pedido volta pelo
    // recuo do PrintLedger e entra no indicador "sem imprimir". A mensagem aparece para o lojista.
    public class PrinterUnavailableException : Exception
    {
        // Código de lista fechada (Services\PrintFailure): é o que vai ao servidor. A mensagem fica só no log local.
        public string Code { get; private set; }
        public PrinterUnavailableException(string message, string code = "OTHER") : base(message) { Code = code; }
        public PrinterUnavailableException(string message, Exception inner, string code = "OTHER") : base(message, inner) { Code = code; }
    }

    // Para onde o tíquete vai: impressora Windows (GdiPrintTarget), arquivos (VirtualPrintTarget, harness
    // sem impressora) e, no futuro, ESC/POS direto. Print retorna só depois de entregue ao destino, e
    // lança PrinterUnavailableException (ou outra exceção) se não foi.
    public interface IPrintTarget
    {
        void Print(TicketDocument document);
    }
}
