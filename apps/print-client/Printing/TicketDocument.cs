using System.Collections.Generic;

namespace MeuCardapio.PrintClient.Printing
{
    public enum TicketAlign { Left, Center, Right }

    // Uma linha lógica do tíquete. Modelo PRÓPRIO do print-client (PC-12): o conteúdo vem do
    // PrintableOrder da nossa API e é montado por TicketBuilder; não existe gramática HTML nem
    // comandos embutidos no texto. Quem desenha (GDI+, texto em colunas, futuramente ESC/POS)
    // recebe sempre este modelo.
    public sealed class TicketLine
    {
        public string Text = "";
        // Texto alinhado à direita NA MESMA linha (ex.: preço). Só faz sentido com Align == Left.
        public string RightText = "";
        public bool Bold;
        public bool Italic;
        public float Scale = 1f;        // 1 = corpo; título usa 1.5; observações 0.85
        public TicketAlign Align = TicketAlign.Left;
        public bool Divider;            // linha tracejada de lado a lado

        public bool IsBlank { get { return !Divider && Text.Length == 0 && RightText.Length == 0; } }
    }

    public sealed class TicketDocument
    {
        // Largura da bobina em mm (58 ou 80 na prática).
        public int PaperMm = 58;
        public readonly List<TicketLine> Lines = new List<TicketLine>();

        public TicketDocument Add(TicketLine line) { Lines.Add(line); return this; }

        public TicketDocument Text(string text, TicketAlign align = TicketAlign.Left, bool bold = false, bool italic = false, float scale = 1f)
        {
            return Add(new TicketLine { Text = text ?? "", Align = align, Bold = bold, Italic = italic, Scale = scale });
        }

        public TicketDocument Pair(string left, string right, bool bold = false, float scale = 1f)
        {
            return Add(new TicketLine { Text = left ?? "", RightText = right ?? "", Bold = bold, Scale = scale });
        }

        public TicketDocument Rule() { return Add(new TicketLine { Divider = true }); }

        public TicketDocument Gap() { return Add(new TicketLine()); }
    }
}
