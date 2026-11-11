using System;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using MouseBridge.Core;

namespace MouseBridge.App
{
    sealed class SettingsForm : Form
    {
        readonly Config _cfg; readonly Bridge _bridge;
        readonly TextBox _code = new TextBox();
        readonly ComboBox _side = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList };
        readonly TextBox _manual = new TextBox();
        readonly Label _status = new Label { AutoSize = true, ForeColor = Color.FromArgb(40, 100, 200) };

        public SettingsForm(Config cfg, Bridge bridge)
        {
            _cfg = cfg; _bridge = bridge;
            Text = "MouseBridge 설정";
            Font = new Font("Malgun Gothic", 9f);
            AutoScaleMode = AutoScaleMode.Font;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false; MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Padding = new Padding(14);

            var grid = new TableLayoutPanel
            {
                ColumnCount = 2, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Location = new Point(14, 14)
            };
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

            void Row(string label, Control control, string hint)
            {
                grid.Controls.Add(new Label { Text = label, AutoSize = true, Margin = new Padding(3, 9, 12, 3) });
                control.Width = 270; control.Margin = new Padding(3, 6, 3, 0);
                grid.Controls.Add(control);
                grid.Controls.Add(new Label { AutoSize = true });
                grid.Controls.Add(new Label { Text = hint, AutoSize = true, MaximumSize = new Size(270, 0), ForeColor = Color.Gray, Margin = new Padding(3, 2, 3, 8) });
            }

            grid.Controls.Add(new Label { Text = "상태", AutoSize = true, Margin = new Padding(3, 3, 12, 10) });
            grid.Controls.Add(_status);

            _code.Text = cfg.Code; _code.CharacterCasing = CharacterCasing.Upper;
            Row("연결 코드", _code, "두 PC에 같은 코드를 입력하세요. 한쪽 PC의 코드를 다른 쪽에 그대로 옮겨 적으면 됩니다.");

            _side.Items.AddRange(new object[] { "오른쪽", "왼쪽" });
            _side.SelectedIndex = cfg.PeerSide == Side.Right ? 0 : 1;
            Row("상대 PC 위치", _side, "이 화면의 어느 쪽 끝으로 마우스를 넘길지 정합니다. 상대 PC는 자동으로 반대쪽으로 맞춰집니다.");

            _manual.Text = cfg.ManualAddress;
            Row("상대 PC 주소", _manual, "보통은 비워 두세요 (자동 탐색). 찾지 못할 때만 상대 PC의 IP를 입력합니다.");

            var buttons = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, AutoSize = true, Anchor = AnchorStyles.Right, Margin = new Padding(0, 8, 0, 0) };
            var close = new Button { Text = "닫기", AutoSize = true };
            var save = new Button { Text = "저장", AutoSize = true };
            var firewall = new Button { Text = "방화벽 허용 추가", AutoSize = true };
            close.Click += (s, e) => Hide();
            save.Click += (s, e) => Save();
            firewall.Click += (s, e) => AddFirewallRule();
            buttons.Controls.Add(close); buttons.Controls.Add(save); buttons.Controls.Add(firewall);
            grid.Controls.Add(buttons);
            grid.SetColumnSpan(buttons, 2);

            Controls.Add(grid);
            AutoSize = true; AutoSizeMode = AutoSizeMode.GrowAndShrink;
            AcceptButton = save; CancelButton = close;
        }

        public void SetStatus(string text)
        {
            if (IsDisposed) return;
            _status.Text = text;
            // The other PC may have changed the layout; keep the list in step unless it is being edited.
            if (!_side.Focused) _side.SelectedIndex = _cfg.PeerSide == Side.Right ? 0 : 1;
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); }
            base.OnFormClosing(e);
        }

        void Save()
        {
            string code = _code.Text.Trim();
            if (code.Replace("-", "").Length < 6)
            {
                MessageBox.Show(this, "연결 코드는 6자 이상이어야 합니다.", "MouseBridge");
                return;
            }
            _bridge.ApplySettings(code, _side.SelectedIndex == 0 ? Side.Right : Side.Left, _manual.Text.Trim());
        }

        void AddFirewallRule()
        {
            try
            {
                string exe = Application.ExecutablePath;
                Process.Start(new ProcessStartInfo("netsh",
                    "advfirewall firewall add rule name=\"MouseBridge\" dir=in action=allow program=\"" + exe + "\" enable=yes profile=any")
                { Verb = "runas", UseShellExecute = true, WindowStyle = ProcessWindowStyle.Hidden });
            }
            catch (Exception ex) { Log.Write("firewall rule: " + ex.Message); } // user declined the admin prompt
        }
    }
}
