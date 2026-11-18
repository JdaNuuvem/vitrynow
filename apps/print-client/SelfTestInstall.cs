using System;
using System.Threading;
using MeuCardapio.PrintClient.Services;

namespace MeuCardapio.PrintClient
{
    // PC-09: uma instancia por computador (o dedupe do ledger vale por processo).
    static class SelfTestInstall
    {
        static void Check(string label, bool cond) { SelfTest.Check(label, cond); }

        public static void Run()
        {
            var name = @"Local\MeuCardapioPrintClient-selftest-" + Guid.NewGuid().ToString("N");
            using (var first = SingleInstance.TryAcquire(name))
            {
                Check("instancia unica: a primeira abertura e a dona", first.IsOwner);

                // Outro processo equivale a outra thread aqui: o mutex pertence a thread que o criou.
                bool secondOwner = true;
                var t = new Thread(() => { using (var second = SingleInstance.TryAcquire(name)) secondOwner = second.IsOwner; });
                t.Start(); t.Join();
                Check("instancia unica: a segunda abertura NAO e dona (nao imprime em duplicidade)", !secondOwner);
            }

            bool afterClose = false;
            var t2 = new Thread(() => { using (var again = SingleInstance.TryAcquire(name)) afterClose = again.IsOwner; });
            t2.Start(); t2.Join();
            Check("instancia unica: fechou a primeira, a proxima abertura volta a ser a dona", afterClose);

            Check("instancia unica: nome global compartilhado com o instalador (AppMutex)", SingleInstance.DefaultName == @"Global\MeuCardapioPrintClient-7C2D4B3E");
        }
    }
}
