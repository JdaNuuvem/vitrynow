using System;
using System.Threading.Tasks;
using MeuCardapio.PrintClient.Models;
using MeuCardapio.PrintClient.Printing;

namespace MeuCardapio.PrintClient.Services
{
    // Liga o que o DeviceClient entrega (PrintableOrder) ao que sai no papel, sem depender de WinForms:
    // monta o tíquete, imprime no destino (impressora Windows ou virtual) e fecha o ciclo com o ledger
    // (RecordPrinted síncrono antes de qualquer outra coisa; ack em outra thread; falha vira "sem imprimir").
    // A MainForm só mostra as mensagens; o harness de testes usa a mesma classe com impressora virtual.
    public sealed class PrintCoordinator
    {
        readonly DeviceClient _device;
        readonly IPrintTarget _target;
        readonly Func<int> _paperMm;
        readonly TimeZoneInfo _timeZone;
        readonly object _printLock = new object();

        // Mensagem curta para o lojista (toast) e para o log.
        public event Action<string> Message;

        // timeZone: fuso para a data do tíquete (null = o do computador; a API ainda não informa o da loja).
        public PrintCoordinator(DeviceClient device, IPrintTarget target, Func<int> paperMm, TimeZoneInfo timeZone = null)
        {
            _device = device; _target = target; _paperMm = paperMm; _timeZone = timeZone;
        }

        // Chamar quando o DeviceClient entrega um pedido (TicketReady). Síncrono até o papel sair.
        public void Handle(PrintableOrder order)
        {
            if (order == null) return;
            try
            {
                var doc = TicketBuilder.Build(order, _paperMm(), _timeZone);
                // Uma impressão por vez: o spooler/PrintDocument e a consulta WMI não são para uso concorrente, e
                // dois tíquetes não podem se misturar. Chamado fora da thread da interface (ver MainForm).
                lock (_printLock) { _target.Print(doc); }
            }
            catch (Exception ex)
            {
                // Falhou: o pedido continua pendente na API e volta depois do recuo do ledger
                // (15 s, 30 s, ... 5 min), sem novo alerta sonoro; entra no indicador "sem imprimir".
                _device.ReportPrintFailed(order.OrderId, order.Code);
                var msg = "Erro na impressão do pedido #" + order.Code + ": " + ex.Message;
                Message?.Invoke(msg);
                return;
            }

            // Imprimiu. No disco AGORA (síncrono), antes de toast, log ou rede (PC-06 a): se o processo cair a
            // seguir, o pedido NÃO é reimpresso. Só o aviso à API vai para outra thread; se falhar, o ack é
            // repetido no próximo ciclo.
            _device.RecordPrinted(order.OrderId);
            Task.Run(() => _device.AckPrintedAsync(order.OrderId));
            Message?.Invoke("Impresso: pedido #" + order.Code);
        }
    }
}
