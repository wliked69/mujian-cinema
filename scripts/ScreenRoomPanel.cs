using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal sealed class ScreenRoomPanel : Form
{
    private enum Phase { Idle, Preparing, Starting, Running, Stopping }
    private readonly string root = AppDomain.CurrentDomain.BaseDirectory;
    private readonly Label status, address, note;
    private readonly Button start, stop, restart, website, admin, backup;
    private readonly Button copyAddress;
    private readonly ComboBox browserChoice;
    private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    private readonly ConcurrentQueue<string> messages = new ConcurrentQueue<string>();
    private Phase phase;
    private Process server;
    private string nodeVersion, failure;
    private int port;
    private bool restartAfterStop, exitRequested, backingUp;

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        string identity = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory).TrimEnd('\\').ToUpperInvariant();
        string key;
        using (var hash = SHA256.Create()) key = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(identity))).Replace("-", "");
        bool first;
        using (var guard = new Mutex(true, "Local\\ScreenRoom-" + key, out first))
        {
            if (!first) { MessageBox.Show("此片库的服务面板已打开，请切换到原窗口。", "幕间", MessageBoxButtons.OK, MessageBoxIcon.Information); return; }
            Application.Run(new ScreenRoomPanel());
        }
    }

    private ScreenRoomPanel()
    {
        Text = "幕间 · 服务管理";
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Microsoft YaHei UI", 10);
        BackColor = Color.FromArgb(243, 247, 245);
        ClientSize = new Size(560, 420);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        AddLabel("幕间  /  SCREEN ROOM", 24, 20, 512, 34, 18, true);
        AddLabel("本机服务管理", 25, 61, 512, 23, 10, false);
        status = AddLabel("服务未启动", 25, 103, 510, 28, 14, true);
        address = AddLabel("", 25, 136, 510, 24, 10, false);
        start = AddButton("启动服务", 25, 176, 150, async delegate { await StartServer(); });
        stop = AddButton("停止服务", 186, 176, 150, delegate { RequestStop(false, false); });
        restart = AddButton("重启服务", 347, 176, 188, delegate { RequestStop(true, false); });
        website = AddButton("打开网站", 25, 224, 248, delegate { OpenBrowser("/"); });
        admin = AddButton("打开管理后台", 285, 224, 250, delegate { OpenBrowser("/admin"); });
        AddLabel("浏览器", 25, 276, 65, 24, 10, false);
        browserChoice = new ComboBox { Location = new Point(91, 272), Size = new Size(315, 30), DropDownStyle = ComboBoxStyle.DropDownList };
        foreach (var choice in ScreenRoomBrowser.Choices()) browserChoice.Items.Add(choice);
        browserChoice.SelectedIndex = 0; Controls.Add(browserChoice);
        copyAddress = AddButton("复制地址", 420, 270, 115, delegate { CopyAddress(); });
        backup = AddButton("一键备份网站资料…", 25, 315, 510, async delegate { await BackupWebsite(); });
        note = AddLabel("关闭窗口会同时停止面板启动的网站。", 25, 365, 510, 42, 9, false);
        UpdateButtons();
        timer.Interval = 120;
        timer.Tick += Poll;
        timer.Start();
        FormClosing += OnClosing;
        FormClosed += delegate { timer.Dispose(); };
    }

    private Label AddLabel(string text, int x, int y, int width, int height, int size, bool bold)
    {
        var label = new Label { Text = text, Location = new Point(x, y), Size = new Size(width, height),
            ForeColor = Color.FromArgb(29, 61, 48), Font = new Font(Font.FontFamily, size, bold ? FontStyle.Bold : FontStyle.Regular) };
        Controls.Add(label);
        return label;
    }

    private Button AddButton(string text, int x, int y, int width, EventHandler click)
    {
        var button = new Button { Text = text, Location = new Point(x, y), Size = new Size(width, 37), UseVisualStyleBackColor = true };
        button.Click += click;
        Controls.Add(button);
        return button;
    }

    private void UpdateButtons()
    {
        start.Enabled = phase == Phase.Idle && !backingUp && !exitRequested;
        stop.Enabled = restart.Enabled = website.Enabled = admin.Enabled = phase == Phase.Running && !exitRequested;
        backup.Enabled = !backingUp && !exitRequested && (phase == Phase.Idle || phase == Phase.Running);
        copyAddress.Enabled = phase == Phase.Running && !exitRequested;
    }

    private ProcessStartInfo HiddenProcess(string file, string args)
    {
        return new ProcessStartInfo(file, args) {
            WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
    }

    private sealed class NodeInfo
    {
        public string Path { get; set; }
        public string Version { get; set; }
    }

    private NodeInfo PrepareNode()
    {
        var ps = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
        var script = Path.Combine(root, "scripts", "bootstrap-node.ps1");
        using (var child = Process.Start(HiddenProcess(ps, "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\" -InstallOnly")))
        {
            child.StandardInput.Close();
            var output = child.StandardOutput.ReadToEndAsync();
            var errors = child.StandardError.ReadToEndAsync();
            child.WaitForExit();
            if (child.ExitCode != 0)
            {
                string detail = errors.Result.Split('\n').FirstOrDefault(line => line.StartsWith("启动准备失败：", StringComparison.Ordinal));
                throw new InvalidOperationException(detail == null ? "无法准备 Node.js，请检查项目文件和网络后重试。" : detail.Trim());
            }
            var json = output.Result.Split('\n').Select(line => line.Trim()).LastOrDefault(line => line.StartsWith("{", StringComparison.Ordinal));
            var node = json == null ? null : new JavaScriptSerializer().Deserialize<NodeInfo>(json);
            if (node == null || !Path.IsPathRooted(node.Path) || !File.Exists(node.Path) || !string.Equals(Path.GetFileName(node.Path), "node.exe", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("未能取得有效的 Node.js 运行路径。");
            return node;
        }
    }

    private async Task StartServer()
    {
        if (phase != Phase.Idle) return;
        phase = Phase.Preparing; port = 0; failure = null;
        status.Text = "正在准备运行环境…"; address.Text = "";
        note.Text = "自动检测 Node.js；首次下载可能需要几分钟。";
        UpdateButtons();
        try
        {
            var node = await Task.Run(() => PrepareNode());
            if (exitRequested) { phase = Phase.Idle; Close(); return; }
            nodeVersion = node.Version;
            var script = Path.Combine(root, "scripts", "desktop-server.mjs");
            var config = HiddenProcess(node.Path, "\"" + script + "\"");
            config.EnvironmentVariables["PATH"] = Path.GetDirectoryName(node.Path) + ";" + config.EnvironmentVariables["PATH"];
            server = new Process { StartInfo = config };
            server.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) {
                if (e.Data != null && e.Data.Length <= 64) messages.Enqueue(e.Data);
            };
            server.ErrorDataReceived += delegate { }; // Drain stderr; never display/log raw server data.
            if (!server.Start()) throw new InvalidOperationException("无法启动网站进程。");
            server.StandardInput.AutoFlush = true;
            server.BeginOutputReadLine();
            server.BeginErrorReadLine();
            phase = Phase.Starting;
            status.Text = "正在启动网站…";
            note.Text = "正在读取片库与网络配置。";
        }
        catch (Exception ex)
        {
            if (server != null) { server.Dispose(); server = null; }
            phase = Phase.Idle; status.Text = "启动未完成"; note.Text = "检查提示后，可以再次点击启动服务。";
            if (exitRequested) { Close(); return; }
            MessageBox.Show(this, ex.Message, "启动未完成", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        UpdateButtons();
    }

    private void Poll(object sender, EventArgs e)
    {
        if (server == null) return;
        bool exited = server.HasExited;
        if (exited) server.WaitForExit(); // Finish asynchronous pipe reads after process exit.
        string line;
        while (messages.TryDequeue(out line))
        {
            int readyPort;
            if (phase == Phase.Starting && line.StartsWith("READY ", StringComparison.Ordinal) &&
                int.TryParse(line.Substring(6), out readyPort) && readyPort >= 1 && readyPort <= 65535)
            {
                port = readyPort; phase = Phase.Running;
                status.Text = "网站运行中"; address.Text = "http://127.0.0.1:" + port + "  ·  Node.js " + nodeVersion;
                note.Text = "网络设置保存后，点「重启服务」使其生效。";
                if (exitRequested) RequestStop(false, true);
            }
            else if (phase == Phase.Stopping && line == "BUSY")
            {
                phase = Phase.Running; restartAfterStop = false;
                status.Text = "网站运行中";
                note.Text = "正在扫描或同步片库，完成后再停止或重启。";
                if (exitRequested) RequestStop(false, true);
            }
            else if (line.StartsWith("ERROR ", StringComparison.Ordinal)) failure = line.Substring(6);
        }
        if (!exited) { UpdateButtons(); return; }
        bool stopped = (phase == Phase.Stopping || phase == Phase.Running) && server.ExitCode == 0;
        server.Dispose(); server = null; address.Text = ""; port = 0; phase = Phase.Idle;
        status.Text = stopped ? "服务已停止" : "服务未运行";
        note.Text = stopped ? "可以重新启动服务。" : FailureMessage();
        bool runAgain = stopped && restartAfterStop && !exitRequested;
        restartAfterStop = false;
        UpdateButtons();
        if (exitRequested && !backingUp) Close();
        else if (runAgain) StartAfterStop();
    }

    private async void StartAfterStop() { await StartServer(); }

    private string FailureMessage()
    {
        switch (failure)
        {
            case "port": return "端口已被占用。请先关闭旧服务，再点击「启动服务」。";
            case "library": return "片库数据无法读取，原文件未被覆盖。请备份后检查。";
            case "network": return "当前 IPv6 或网络设置无法监听，请检查系统网络设置。";
            case "save": return "停止时保存失败，请检查片库目录权限。";
            default: return "网站进程已退出。请检查项目文件和网络设置后重试。";
        }
    }

    private void RequestStop(bool runAgain, bool close)
    {
        if (phase != Phase.Running) return;
        restartAfterStop = runAgain;
        phase = Phase.Stopping;
        status.Text = "正在停止服务…"; note.Text = "正在关闭连接并等待数据保存。";
        UpdateButtons();
        try { server.StandardInput.WriteLine(close ? "shutdown" : "stop"); }
        catch (IOException) { note.Text = "服务连接已断开，正在等待进程结束。"; }
    }

    private void OpenBrowser(string path)
    {
        if (phase != Phase.Running || port == 0) return;
        try {
            ScreenRoomBrowser.Open(port, path, browserChoice.SelectedItem as ScreenRoomBrowserChoice,
                browserChoice.Items.Cast<ScreenRoomBrowserChoice>(), info => { using (var process = Process.Start(info)) { return info.UseShellExecute || process != null; } });
            note.Text = "如果浏览器未弹出，请切换上方浏览器，或点击「复制地址」。";
        } catch (Exception error) { MessageBox.Show(this, error.Message, "无法打开网站", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
    }

    private void CopyAddress()
    {
        if (phase != Phase.Running || port == 0) return;
        try { Clipboard.SetText(ScreenRoomBrowser.Address(port, "/")); note.Text = "网站地址已复制，可粘贴到浏览器地址栏；管理入口为 /admin。"; }
        catch { MessageBox.Show(this, "无法写入剪贴板，请手动输入面板显示的网站地址。", "复制未完成"); }
    }

    private void OnClosing(object sender, FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.WindowsShutDown || e.CloseReason == CloseReason.TaskManagerClosing) return;
        if (phase == Phase.Idle && !backingUp) return;
        e.Cancel = true;
        exitRequested = true;
        restartAfterStop = false;
        if (phase == Phase.Running) RequestStop(false, true);
        else note.Text = "正在完成当前操作，随后将自动退出。";
        UpdateButtons();
    }

    private async Task BackupWebsite()
    {
        if (backingUp || exitRequested) return;
        string destination;
        using (var dialog = new SaveFileDialog { Title = "保存幕间整站资料（含用户账号，请私密保管）",
            Filter = "ZIP 压缩包 (*.zip)|*.zip", DefaultExt = "zip", AddExtension = true, OverwritePrompt = true,
            FileName = "幕间-整站资料-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".zip" })
        {
            if (dialog.ShowDialog(this) != DialogResult.OK) return;
            destination = dialog.FileName;
        }
        backingUp = true; UpdateButtons();
        note.Text = "正在打包账号、影片详情、网站设置及已缓存的封面…";
        try
        {
            await Task.Run(() => ScreenRoomBackup.Create(root, destination));
            if (!exitRequested) note.Text = "备份已保存。ZIP 含账号与配置，请不要公开分享。";
        }
        catch (Exception error)
        {
            if (!exitRequested) MessageBox.Show(this, error is InvalidOperationException ? error.Message : "无法完成备份，请检查保存位置、磁盘空间和文件权限。", "备份失败", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            note.Text = "备份未完成，网站原资料未修改。";
        }
        finally
        {
            backingUp = false; UpdateButtons();
            if (exitRequested && phase == Phase.Idle) Close();
        }
    }
}
