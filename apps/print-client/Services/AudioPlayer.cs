using System;
using System.IO;

namespace MeuCardapio.PrintClient.Services
{
    // Som de alerta via WindowsMediaPlayer (COM) — mesma técnica usada na engenharia reversa do
    // módulo original, genérica e sem dependência de marca.
    public class AudioPlayer : IDisposable
    {
        dynamic _wmp;

        public void Init()
        {
            if (_wmp != null) return;
            try
            {
                var t = Type.GetTypeFromProgID("WMPlayer.OCX");
                _wmp = Activator.CreateInstance(t);
            }
            catch
            {
                _wmp = null; // sem WMP no sistema -> silencia
            }
        }

        public void Play(int dropdownIndex, string customSound, int volume)
        {
            if (_wmp == null) return;
            try
            {
                string file = ResolveSound(dropdownIndex, customSound);
                if (string.IsNullOrEmpty(file) || !File.Exists(file)) return;

                _wmp.URL = file;
                _wmp.Volume = Math.Max(0, Math.Min(100, volume));
                _wmp.Controls.Play();
            }
            catch { /* áudio é best-effort */ }
        }

        static string ResolveSound(int dropdownIndex, string customSound)
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            switch (dropdownIndex)
            {
                case 1: return Path.Combine(baseDir, "Audios", "Sino.wav");
                case 2: return Path.Combine(baseDir, "Audios", "Padrao.wav");
                default: return customSound;
            }
        }

        public void Dispose()
        {
            try { if (_wmp != null) _wmp.Quit(); } catch { }
            _wmp = null;
        }
    }
}
