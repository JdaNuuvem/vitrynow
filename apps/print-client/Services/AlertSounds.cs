using System;
using System.IO;
using System.Text;

namespace MeuCardapio.PrintClient.Services
{
    // Sons de alerta GERADOS pelo próprio app (sem arquivos de áudio de terceiros, sem Windows Media Player):
    // "Sino" (duas batidas com decaimento) e "Padrão" (dois bipes). WAV PCM 16 bits mono. Volume (0-100) já
    // aplicado nas amostras: SoundPlayer não tem controle de volume. ScaleWav faz o mesmo em um .wav escolhido
    // pelo lojista (só PCM 16 bits; outros formatos tocam sem ajuste de volume).
    public static class AlertSounds
    {
        const int Rate = 22050;

        public static byte[] Bell(int volume)
        {
            var samples = new short[(int)(Rate * 1.2)];
            AddStrike(samples, 0.00, 880.0, 0.9);
            AddStrike(samples, 0.45, 1174.66, 0.9);
            return ToWav(samples, volume);
        }

        public static byte[] Chime(int volume)
        {
            var samples = new short[(int)(Rate * 0.7)];
            AddBeep(samples, 0.00, 0.18, 1000.0);
            AddBeep(samples, 0.28, 0.18, 1400.0);
            return ToWav(samples, volume);
        }

        // Batida de sino: fundamental + harmônico, envelope exponencial.
        static void AddStrike(short[] buf, double startSec, double freq, double amp)
        {
            int start = (int)(startSec * Rate);
            for (int i = 0; start + i < buf.Length; i++)
            {
                double t = (double)i / Rate;
                double env = Math.Exp(-t * 5.5) * Math.Min(1.0, t * 400.0); // ataque curto, decaimento
                double v = Math.Sin(2 * Math.PI * freq * t) * 0.7 + Math.Sin(2 * Math.PI * freq * 2.76 * t) * 0.3;
                Mix(buf, start + i, v * env * amp * 0.5);
            }
        }

        static void AddBeep(short[] buf, double startSec, double lenSec, double freq)
        {
            int start = (int)(startSec * Rate), len = (int)(lenSec * Rate);
            for (int i = 0; i < len && start + i < buf.Length; i++)
            {
                double t = (double)i / Rate;
                double env = Math.Min(1.0, Math.Min(t * 200.0, (lenSec - t) * 200.0)); // rampa para não estalar
                Mix(buf, start + i, Math.Sin(2 * Math.PI * freq * t) * env * 0.5);
            }
        }

        static void Mix(short[] buf, int index, double value)
        {
            int v = buf[index] + (int)Math.Round(value * short.MaxValue);
            buf[index] = (short)Math.Max(short.MinValue, Math.Min(short.MaxValue, v));
        }

        static byte[] ToWav(short[] samples, int volume)
        {
            double gain = Gain(volume);
            var pcm = new byte[samples.Length * 2];
            for (int i = 0; i < samples.Length; i++)
            {
                short s = (short)Math.Round(samples[i] * gain);
                pcm[2 * i] = (byte)(s & 0xff);
                pcm[2 * i + 1] = (byte)((s >> 8) & 0xff);
            }
            using (var ms = new MemoryStream())
            using (var w = new BinaryWriter(ms, Encoding.ASCII))
            {
                w.Write(Encoding.ASCII.GetBytes("RIFF")); w.Write(36 + pcm.Length); w.Write(Encoding.ASCII.GetBytes("WAVE"));
                w.Write(Encoding.ASCII.GetBytes("fmt ")); w.Write(16); w.Write((short)1); w.Write((short)1);
                w.Write(Rate); w.Write(Rate * 2); w.Write((short)2); w.Write((short)16);
                w.Write(Encoding.ASCII.GetBytes("data")); w.Write(pcm.Length); w.Write(pcm);
                w.Flush();
                return ms.ToArray();
            }
        }

        // Curva quadrática: o controle de 0 a 100 soa mais uniforme do que linear.
        public static double Gain(int volume)
        {
            double v = Math.Max(0, Math.Min(100, volume)) / 100.0;
            return v * v;
        }

        // Escala as amostras de um WAV PCM 16 bits (qualquer nº de canais). Outro formato ou arquivo inválido: devolve igual.
        public static byte[] ScaleWav(byte[] wav, int volume)
        {
            int dataOffset, dataLength;
            if (!TryFindPcm16Data(wav, out dataOffset, out dataLength)) return wav;
            double gain = Gain(volume);
            var copy = (byte[])wav.Clone();
            for (int i = dataOffset; i + 1 < dataOffset + dataLength; i += 2)
            {
                short s = (short)(copy[i] | (copy[i + 1] << 8));
                short r = (short)Math.Max(short.MinValue, Math.Min(short.MaxValue, Math.Round(s * gain)));
                copy[i] = (byte)(r & 0xff); copy[i + 1] = (byte)((r >> 8) & 0xff);
            }
            return copy;
        }

        public static bool IsPcm16Wav(byte[] wav)
        {
            int o, l;
            return TryFindPcm16Data(wav, out o, out l);
        }

        static bool TryFindPcm16Data(byte[] b, out int dataOffset, out int dataLength)
        {
            dataOffset = 0; dataLength = 0;
            if (b == null || b.Length < 44) return false;
            if (Encoding.ASCII.GetString(b, 0, 4) != "RIFF" || Encoding.ASCII.GetString(b, 8, 4) != "WAVE") return false;
            bool pcm16 = false;
            int pos = 12;
            while (pos + 8 <= b.Length)
            {
                var id = Encoding.ASCII.GetString(b, pos, 4);
                int size = BitConverter.ToInt32(b, pos + 4);
                if (size < 0) return false;
                if (id == "fmt " && size >= 16 && pos + 8 + 16 <= b.Length)
                {
                    int format = BitConverter.ToInt16(b, pos + 8);
                    int bits = BitConverter.ToInt16(b, pos + 8 + 14);
                    pcm16 = format == 1 && bits == 16;
                }
                else if (id == "data")
                {
                    if (!pcm16) return false;
                    dataOffset = pos + 8;
                    dataLength = Math.Min(size, b.Length - dataOffset);
                    return dataLength > 0;
                }
                long next = (long)pos + 8 + size + (size & 1);
                if (next > b.Length) return false;
                pos = (int)next;
            }
            return false;
        }

        // Pico (valor absoluto máximo) das amostras PCM 16 bits; 0 se não for PCM16. Útil nos testes.
        public static int Peak(byte[] wav)
        {
            int o, l;
            if (!TryFindPcm16Data(wav, out o, out l)) return 0;
            int peak = 0;
            for (int i = o; i + 1 < o + l; i += 2)
                peak = Math.Max(peak, Math.Abs((short)(wav[i] | (wav[i + 1] << 8))));
            return peak;
        }
    }
}
