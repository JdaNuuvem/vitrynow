using System;
using System.Text;
using MeuCardapio.PrintClient.Services;

namespace MeuCardapio.PrintClient
{
    // PC-14: sons de alerta próprios (gerados), sem Windows Media Player nem arquivos de terceiros.
    // Não toca áudio de verdade (sem placa de som no teste): confere os bytes do WAV e o ajuste de volume.
    static class SelfTestAudio
    {
        static void Check(string label, bool cond) { SelfTest.Check(label, cond); }

        public static void Run()
        {
            var bell = AlertSounds.Bell(100);
            var chime = AlertSounds.Chime(100);
            Check("som: Sino e um WAV PCM 16 bits mono valido", AlertSounds.IsPcm16Wav(bell) && Encoding.ASCII.GetString(bell, 0, 4) == "RIFF" && Encoding.ASCII.GetString(bell, 36, 4) == "data");
            Check("som: Padrao e um WAV PCM 16 bits mono valido", AlertSounds.IsPcm16Wav(chime));
            Check("som: tamanhos do cabecalho batem com o arquivo", BitConverter.ToInt32(bell, 4) == bell.Length - 8 && BitConverter.ToInt32(bell, 40) == bell.Length - 44);
            double bellSec = (bell.Length - 44) / 2.0 / 22050.0, chimeSec = (chime.Length - 44) / 2.0 / 22050.0;
            Check("som: duracao curta (Sino ~1,2 s, Padrao ~0,7 s)", Math.Abs(bellSec - 1.2) < 0.05 && Math.Abs(chimeSec - 0.7) < 0.05);
            Check("som: volume 100 tem pico audivel e sem estourar", AlertSounds.Peak(bell) > 6000 && AlertSounds.Peak(bell) <= short.MaxValue);
            Check("som: volume 0 e silencio", AlertSounds.Peak(AlertSounds.Bell(0)) == 0 && AlertSounds.Peak(AlertSounds.Chime(0)) == 0);
            Check("som: volume menor => pico menor (curva quadratica)", AlertSounds.Peak(AlertSounds.Bell(50)) < AlertSounds.Peak(AlertSounds.Bell(100)) * 0.4
                && AlertSounds.Peak(AlertSounds.Bell(20)) < AlertSounds.Peak(AlertSounds.Bell(50)));
            Check("som: volume fora da faixa e limitado (-5 => 0, 500 => 100)", AlertSounds.Peak(AlertSounds.Bell(-5)) == 0 && AlertSounds.Peak(AlertSounds.Bell(500)) == AlertSounds.Peak(AlertSounds.Bell(100)));

            // .wav do lojista
            var scaled = AlertSounds.ScaleWav(bell, 50);
            Check("wav proprio: PCM 16 bits tem o volume ajustado e o cabecalho intacto", scaled.Length == bell.Length && AlertSounds.Peak(scaled) < AlertSounds.Peak(bell) * 0.4 && AlertSounds.IsPcm16Wav(scaled));
            Check("wav proprio: nao altera o arquivo original (copia)", AlertSounds.Peak(bell) == AlertSounds.Peak(AlertSounds.Bell(100)));
            var junk = new byte[] { 1, 2, 3, 4, 5 };
            Check("wav proprio: lixo, nulo e vazio voltam iguais, sem excecao", AlertSounds.ScaleWav(junk, 50) == junk && AlertSounds.ScaleWav(null, 50) == null && AlertSounds.ScaleWav(new byte[0], 50).Length == 0);
            var notPcm = (byte[])bell.Clone(); notPcm[20] = 3; // formato 3 = float: nao mexe
            Check("wav proprio: formato que nao e PCM16 toca sem ajuste (volta igual)", ReferenceEquals(AlertSounds.ScaleWav(notPcm, 10), notPcm) && !AlertSounds.IsPcm16Wav(notPcm));
            var truncated = new byte[60]; Array.Copy(bell, truncated, 60);
            Check("wav proprio: arquivo truncado nao estoura", AlertSounds.Peak(AlertSounds.ScaleWav(truncated, 50)) >= 0);
            var badSize = (byte[])bell.Clone(); badSize[40] = 0xff; badSize[41] = 0xff; badSize[42] = 0xff; badSize[43] = 0x7f; // tamanho do data absurdo
            Check("wav proprio: tamanho de bloco absurdo e limitado ao arquivo", AlertSounds.Peak(AlertSounds.ScaleWav(badSize, 50)) > 0);

            // AudioPlayer.BuildWav: escolha do som (sem tocar)
            Check("player: 1 = Sino, 2 = Padrao", AudioPlayer.BuildWav(1, "", 100).Length == bell.Length && AudioPlayer.BuildWav(2, "", 100).Length == chime.Length);
            Check("player: som personalizado ausente ou invalido => nada a tocar", AudioPlayer.BuildWav(3, "", 100) == null && AudioPlayer.BuildWav(3, @"C:\nao\existe.wav", 100) == null);
            var tmp = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "mc_audio_" + Guid.NewGuid().ToString("N"));
            System.IO.Directory.CreateDirectory(tmp);
            try
            {
                var wavFile = System.IO.Path.Combine(tmp, "meu.wav"); System.IO.File.WriteAllBytes(wavFile, bell);
                var mp3File = System.IO.Path.Combine(tmp, "meu.mp3"); System.IO.File.WriteAllBytes(mp3File, bell);
                Check("player: .wav do lojista e lido e escalado", AlertSounds.Peak(AudioPlayer.BuildWav(3, wavFile, 50)) < AlertSounds.Peak(bell) * 0.4);
                Check("player: extensao que nao e .wav e recusada (SoundPlayer so toca WAV)", AudioPlayer.BuildWav(3, mp3File, 100) == null);
            }
            finally { try { System.IO.Directory.Delete(tmp, true); } catch { } }
        }
    }
}
