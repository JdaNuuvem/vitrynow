using Newtonsoft.Json;

namespace MeuCardapio.PrintClient.Models
{
    // Job de impressão entregue pelo claim (ADR-0004 §2/§6; formato em docs\contrato-printjob-cliente.md).
    public class PrintJobDto
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("kind")] public string Kind { get; set; }
        [JsonProperty("attempt")] public int? Attempt { get; set; }
        // Relativo: o cliente começa a contar quando recebe a resposta (não confia no relógio do PC).
        [JsonProperty("leaseSeconds")] public int? LeaseSeconds { get; set; }
        [JsonProperty("ticket")] public PrintableOrder Ticket { get; set; }

        public const string KindKitchen = "ORDER_KITCHEN";
        public const string KindReprint = "ORDER_REPRINT";
        public const string KindTest = "TEST";
        public const int DefaultLeaseSeconds = 60;

        // Chave no PrintLedger: por JOB, não por pedido (original e 2ª via do mesmo pedido são jobs diferentes).
        public string Key { get { return "job:" + Id; } }
    }

    public class ClaimResponse
    {
        [JsonProperty("job")] public PrintJobDto Job { get; set; }
    }
}
