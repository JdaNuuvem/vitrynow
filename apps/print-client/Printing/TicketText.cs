using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace MeuCardapio.PrintClient.Printing
{
    // Regras de texto compartilhadas por todos os "desenhistas" do tíquete.
    public static class TicketText
    {
        // Colunas de um caractere fixo por largura de bobina (fonte A das térmicas comuns):
        // 58 mm ~ 32 colunas, 80 mm ~ 48 colunas.
        public static int ColumnsFor(int paperMm)
        {
            if (paperMm >= 76) return 48;
            if (paperMm >= 56) return 32;
            return 24;
        }

        // Texto livre vindo do pedido (nome, observação, endereço) é DADO, nunca comando (D4-6, Sun Tzu):
        // remove caracteres de controle C0 e DEL (ESC, GS, BEL... que numa térmica ESC/POS cortam papel ou
        // abrem gaveta), separadores unicode de linha/parágrafo e marcas de direção; tabulação e quebras de
        // linha viram espaço. Emoji e acentos ficam.
        public static string Sanitize(string value)
        {
            if (string.IsNullOrEmpty(value)) return "";
            var sb = new StringBuilder(value.Length);
            bool lastSpace = false;
            foreach (var ch in value)
            {
                char c = ch;
                if (c == '\t' || c == '\r' || c == '\n' || c == '\u2028' || c == '\u2029' || c == '\u0085') c = ' ';
                if (c < ' ' || c == '\u007f') continue;
                if (c >= '\u0080' && c <= '\u009f') continue;                 // C1
                if (c >= '\u202a' && c <= '\u202e') continue;                 // marcas de direção (bidi override)
                if (c >= '\u2066' && c <= '\u2069') continue;
                if (c == '\u200b' || c == '\u200e' || c == '\u200f' || c == '\ufeff') continue;
                if (c == ' ') { if (lastSpace) continue; lastSpace = true; } else lastSpace = false;
                sb.Append(c);
            }
            return sb.ToString().Trim();
        }

        // Para o PAPEL: Sanitize + sem emoji/pictogramas. Fonte de impressora e code page de térmica não têm emoji
        // (sairia um quadradinho); o texto em volta continua. Acentos, pontuação e símbolos de moeda ficam.
        public static string PrintSafe(string value)
        {
            var clean = Sanitize(value);
            if (clean.Length == 0) return clean;
            var sb = new StringBuilder(clean.Length);
            for (int i = 0; i < clean.Length; i++)
            {
                int cp = clean[i];
                if (char.IsHighSurrogate(clean[i]) && i + 1 < clean.Length && char.IsLowSurrogate(clean[i + 1]))
                {
                    cp = char.ConvertToUtf32(clean[i], clean[i + 1]);
                    i++;
                }
                if (IsPictographic(cp)) continue;
                if (cp > 0xFFFF) sb.Append(char.ConvertFromUtf32(cp)); else sb.Append((char)cp);
            }
            return Sanitize(sb.ToString());
        }

        static bool IsPictographic(int cp)
        {
            return cp >= 0x1F000                              // emoji, bandeiras, símbolos suplementares
                || (cp >= 0x2600 && cp <= 0x27BF)             // símbolos diversos e dingbats
                || (cp >= 0x2B00 && cp <= 0x2BFF)             // setas e estrelas (⭐)
                || (cp >= 0xFE00 && cp <= 0xFE0F)             // seletores de variação
                || cp == 0x200D || cp == 0x20E3;              // ZWJ e keycap
        }

        // Quebra em linhas que cabem em maxWidth segundo `measure` (colunas ou pixels). Palavras maiores que
        // a largura são cortadas por "elemento de texto" (não separa par substituto de emoji nem acento combinado).
        public static List<string> Wrap(string text, float maxWidth, Func<string, float> measure)
        {
            var lines = new List<string>();
            if (string.IsNullOrEmpty(text)) { lines.Add(""); return lines; }
            // Recuo inicial (ex.: "  + adicional") vale para todas as linhas do trecho (recuo suspenso).
            int indent = text.Length - text.TrimStart(' ').Length;
            if (indent > 0 && indent < text.Length)
            {
                var pad = new string(' ', indent);
                var inner = Wrap(text.Substring(indent), Math.Max(1f, maxWidth - measure(pad)), measure);
                for (int k = 0; k < inner.Count; k++) inner[k] = pad + inner[k];
                return inner;
            }
            var current = "";
            foreach (var word in text.Split(' '))
            {
                if (word.Length == 0) continue;
                var candidate = current.Length == 0 ? word : current + " " + word;
                if (measure(candidate) <= maxWidth) { current = candidate; continue; }
                if (current.Length > 0) { lines.Add(current); current = ""; }
                if (measure(word) <= maxWidth) { current = word; continue; }
                // palavra gigante: corta por elementos de texto
                var piece = "";
                var e = StringInfo.GetTextElementEnumerator(word);
                while (e.MoveNext())
                {
                    var el = (string)e.Current;
                    if (piece.Length > 0 && measure(piece + el) > maxWidth) { lines.Add(piece); piece = ""; }
                    piece += el;
                }
                current = piece;
            }
            if (current.Length > 0 || lines.Count == 0) lines.Add(current);
            return lines;
        }

        // Largura em colunas: cada elemento de texto vale 1, exceto emoji/CJK largos (2).
        public static int CellWidth(string s)
        {
            if (string.IsNullOrEmpty(s)) return 0;
            int w = 0;
            var e = StringInfo.GetTextElementEnumerator(s);
            while (e.MoveNext())
            {
                var el = (string)e.Current;
                w += IsWide(el) ? 2 : 1;
            }
            return w;
        }

        // Mesma medida como float, para Wrap(measure).
        public static float CellWidthF(string s) { return CellWidth(s); }

        static bool IsWide(string element)
        {
            int cp = char.ConvertToUtf32(element, 0);
            return (cp >= 0x1F300 && cp <= 0x1FAFF) || (cp >= 0x2600 && cp <= 0x27BF) || (cp >= 0x1100 && cp <= 0x115F)
                || (cp >= 0x2E80 && cp <= 0xA4CF) || (cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0xFF00 && cp <= 0xFF60);
        }
    }
}
