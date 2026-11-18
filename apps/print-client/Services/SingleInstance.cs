using System;
using System.Threading;

namespace MeuCardapio.PrintClient.Services
{
    // Uma instância do print-client por computador (PC-09). O dedupe do PrintLedger vale dentro de UM processo:
    // dois aplicativos abertos (início automático + clique no atalho, ou dois usuários do Windows) leriam a mesma
    // fila e imprimiriam o mesmo pedido duas vezes. O mutex é Global\ (vale entre sessões do Windows) e o mesmo
    // nome está no instalador (AppMutex), que pede para fechar o app antes de atualizar.
    public sealed class SingleInstance : IDisposable
    {
        public const string DefaultName = @"Global\MeuCardapioPrintClient-7C2D4B3E";

        readonly Mutex _mutex;
        bool _owned;

        public bool IsOwner { get { return _owned; } }

        SingleInstance(Mutex m, bool owned) { _mutex = m; _owned = owned; }

        // Devolve o objeto com IsOwner == true se este processo é a única instância; false se já há outra.
        public static SingleInstance TryAcquire(string name = DefaultName)
        {
            bool created;
            var m = new Mutex(true, name, out created);
            return new SingleInstance(m, created);
        }

        public void Dispose()
        {
            try { if (_owned) _mutex.ReleaseMutex(); } catch { }
            try { _mutex.Dispose(); } catch { }
            _owned = false;
        }
    }
}
