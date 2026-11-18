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
            var sb = new StringBuilder(Math.Min(value.Length, 4096));
            bool lastSpace = false;
            int combining = 0;
            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                if (c == '\t' || c == '\r' || c == '\n' || c == (char)0x2028 || c == (char)0x2029 || c == (char)0x0085) c = ' ';
                if (c < ' ' || c == (char)0x7f) continue;
                if (c >= (char)0x80 && c <= (char)0x9f) continue;                      // C1
                if (c >= (char)0x202a && c <= (char)0x202e) continue;                  // marcas de direcao (bidi override)
                if (c >= (char)0x2066 && c <= (char)0x2069) continue;
                if (c == (char)0x200b || c == (char)0x200e || c == (char)0x200f || c == (char)0xfeff) continue;
                // invisiveis e de formatacao sem funcao no papel (PC-15, parecer Nightingale)
                if (c == (char)0x061c || c == (char)0x2060 || c == (char)0x180e || c == (char)0x034f) continue;
                if (c >= (char)0xfff9 && c <= (char)0xfffc) continue;                  // anotacoes interlineares e objeto
                if (c >= (char)0xe000 && c <= (char)0xf8ff) continue;                  // uso privado
                if (char.IsSurrogate(c))
                {
                    // so passa o PAR valido (emoji); substituto solto e lixo e pode quebrar o desenho/ESC-POS
                    if (char.IsHighSurrogate(c) && i + 1 < value.Length && char.IsLowSurrogate(value[i + 1]))
                    {
                        int cp = char.ConvertToUtf32(c, value[i + 1]);
                        if (cp >= 0xF0000) { i++; continue; }                          // planos de uso privado 15/16
                        sb.Append(c).Append(value[i + 1]); i++; lastSpace = false; combining = 0;
                    }
                    continue;
                }
                // marcas combinantes (acento): no maximo 2 por letra (barra o "zalgo", que estoura a altura da linha)
                var cat = CharUnicodeInfo.GetUnicodeCategory(c);
                if (cat == UnicodeCategory.NonSpacingMark || cat == UnicodeCategory.EnclosingMark || cat == UnicodeCategory.SpacingCombiningMark)
                {
                    if (combining >= 2) continue;
                    combining++;
                }
                else combining = 0;
                if (c == ' ') { if (lastSpace) continue; lastSpace = true; } else lastSpace = false;
                sb.Append(c);
                if (sb.Length >= MaxScan) break;                                       // nao processa megabytes para depois truncar
            }
            return sb.ToString().Trim();
        }

        // Teto de varredura de um campo (bem acima do que sai no papel): evita gastar CPU com texto de megabytes.
        const int MaxScan = 20000;
        // Teto de um campo no papel (observacao, nome, endereco): 300 caracteres, com reticencias.
        public const int MaxFieldChars = 300;
        // Teto do tiquete: itens e adicionais por item. Acima disso o papel avisa e manda ver no painel.
        public const int MaxItemLines = 80;
        public const int MaxAdditionalsPerItem = 12;

        // Corta no limite sem partir par de emoji nem letra com acento, e marca com reticencias.
        public static string Truncate(string value, int max)
        {
            if (string.IsNullOrEmpty(value) || value.Length <= max) return value ?? "";
            int cut = max;
            while (cut > 0 && (char.IsLowSurrogate(value[cut]) || CharUnicodeInfo.GetUnicodeCategory(value[cut]) == UnicodeCategory.NonSpacingMark)) cut--;
            return value.Substring(0, cut).TrimEnd() + (char)0x2026;
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
