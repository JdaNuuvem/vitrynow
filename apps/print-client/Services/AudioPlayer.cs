using System;
using System.IO;
using System.Media;
using System.Threading;

namespace MeuCardapio.PrintClient.Services
{
    // Toca o alerta de novo pedido com System.Media.SoundPlayer (sem COM, sem Windows Media Player, sem
    // arquivos de áudio embutidos): os sons "Sino" e "Padrão" são gerados por AlertSounds; o lojista pode
    // escolher um .wav próprio (PCM 16 bits tem o volume ajustado). Áudio é best-effort: falha = silêncio.
    public sealed class AudioPlayer : IDisposable
    {
        const long MaxCustomBytes = 5L * 1024 * 1024;
        readonly object _lock = new object();
        SoundPlayer _player;
        MemoryStream _stream;

        public void Init() { /* nada a preparar: o som é gerado ao tocar */ }

        public void Play(int dropdownIndex, string customSound, int volume)
        {
            try
            {
                byte[] wav = BuildWav(dropdownIndex, customSound, volume);
                if (wav == null) return;
                lock (_lock)
                {
                    StopLocked();
                    _stream = new MemoryStream(wav);
                    _player = new SoundPlayer(_stream);
                    _player.Play(); // assíncrono; um novo pedido interrompe o som anterior
                }
            }
            catch { /* sem placa de som, arquivo ruim, etc. */ }
        }

        // 1 = Sino, 2 = Padrão, 3 = arquivo .wav do lojista. Devolve null se não há o que tocar.
        public static byte[] BuildWav(int dropdownIndex, string customSound, int volume)
        {
            switch (dropdownIndex)
            {
                case 1: return AlertSounds.Bell(volume);
                case 2: return AlertSounds.Chime(volume);
                default:
                    if (string.IsNullOrWhiteSpace(customSound) || !File.Exists(customSound)) return null;
                    var info = new FileInfo(customSound);
                    if (info.Length > MaxCustomBytes || !string.Equals(info.Extension, ".wav", StringComparison.OrdinalIgnoreCase)) return null;
                    return AlertSounds.ScaleWav(File.ReadAllBytes(customSound), volume);
            }
        }

        void StopLocked()
        {
            try { if (_player != null) { _player.Stop(); _player.Dispose(); } } catch { }
            try { if (_stream != null) _stream.Dispose(); } catch { }
            _player = null; _stream = null;
        }

        public void Dispose() { lock (_lock) StopLocked(); }
    }
}
