using System;

namespace MeuCardapio.PrintClient
{
    // Autoteste do print-client: .\run-selftest.ps1 (compila numa DLL e roda em memoria, sem abrir o EXE)
    // ou o proprio EXE com --selftest. Cada suite chama Check(); Failures conta as que falharam.
    static class SelfTest
    {
        internal static int Failures;

        internal static void Check(string label, bool cond)
        {
            Console.WriteLine((cond ? "PASS " : "FAIL ") + label);
            if (!cond) Failures++;
        }

        public static int Run()
        {
            SelfTestPrint.Run();        // tiquete: modelo, quebra de linha, sanitizacao, golden files 58/80 mm
            SelfTestDevice.Run();       // PC-02: ledger, dedupe, DPAPI, politica de URL, settings
            SelfTestUpdater.Run();      // PC-04: updater com manifesto assinado
            SelfTestDeviceClient.Run(); // PC-05/06: DeviceClient real contra API falsa
            SelfTestInstall.Run();      // PC-09: instancia unica
            SelfTestAudio.Run();        // PC-14: sons de alerta gerados (sem WMP nem arquivos de terceiros)
            SelfTestJobs.Run();         // PC-03: cliente no modo PrintJob (claim/ack, ADR-0004)
            SelfTestHarness.Run();      // PC-12/QA-06: pipeline completo com impressora virtual e falhas simuladas

            Console.WriteLine(Failures == 0 ? "ALL OK" : "FAILURES=" + Failures);
            return Failures == 0 ? 0 : 1;
        }
    }
}
