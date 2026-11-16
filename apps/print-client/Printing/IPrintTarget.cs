using System;

namespace MeuCardapio.PrintClient.Printing
{
    // Falha PREVISÍVEL da impressora (offline, sem papel, sem seleção, cabo solto): o pedido volta pelo
    // recuo do PrintLedger e entra no indicador "sem imprimir". A mensagem aparece para o lojista.
    public class PrinterUnavailableException : Exception
    {
        public PrinterUnavailableException(string message) : base(message) { }
        public PrinterUnavailableException(string message, Exception inner) : base(message, inner) { }
    }

    // Para onde o tíquete vai: impressora Windows (GdiPrintTarget), arquivos (VirtualPrintTarget, harness
    // sem impressora) e, no futuro, ESC/POS direto. Print retorna só depois de entregue ao destino, e
    // lança PrinterUnavailableException (ou outra exceção) se não foi.
    public interface IPrintTarget
    {
        void Print(TicketDocument document);
    }
}
