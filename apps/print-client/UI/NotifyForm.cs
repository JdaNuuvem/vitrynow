using System.Drawing;
using System.Windows.Forms;

namespace MeuCardapio.PrintClient.UI
{
    // Balão flutuante de "novo pedido" que some sozinho.
    public class NotifyForm : Form
    {
        public NotifyForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            ShowInTaskbar = false;
            ClientSize = new Size(280, 70);
            Location = new Point(Screen.PrimaryScreen.WorkingArea.Right - 300, Screen.PrimaryScreen.WorkingArea.Top + 40);
            BackColor = Color.FromArgb(30, 30, 60);

            var icon = new Label { Text = "🔔", Font = new Font("Segoe UI Emoji", 20f), ForeColor = Color.White, Location = new Point(10, 15) };
            var msg = new Label { Text = "Novo pedido recebido!", AutoSize = true, Font = new Font("Segoe UI", 11f, FontStyle.Bold), ForeColor = Color.White, Location = new Point(55, 25) };
            Controls.AddRange(new Control[] { icon, msg });

            var timer = new Timer { Interval = 6000 };
            timer.Tick += (s, e) => { timer.Stop(); Close(); };
            timer.Start();
        }
    }
}
