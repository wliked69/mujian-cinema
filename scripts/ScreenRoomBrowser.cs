using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;

internal sealed class ScreenRoomBrowserChoice
{
    internal string Name;
    internal string Executable;
    internal ScreenRoomBrowserChoice(string name, string executable) { Name = name; Executable = executable; }
    public override string ToString() { return Name; }
}

internal static class ScreenRoomBrowser
{
    [DllImport("shlwapi.dll", CharSet = CharSet.Unicode)]
    private static extern uint AssocQueryString(uint flags, uint kind, string association, string extra, StringBuilder output, ref uint length);

    internal static string Address(int port, string page)
    {
        if (port < 1 || port > 65535 || (page != "/" && page != "/admin")) throw new ArgumentException("网站地址无效。");
        return "http://127.0.0.1:" + port + page;
    }

    internal static List<ScreenRoomBrowserChoice> Choices()
    {
        var list = new List<ScreenRoomBrowserChoice> { new ScreenRoomBrowserChoice("自动选择浏览器", null) };
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        Action<string, string> add = (name, file) => {
            if (!string.IsNullOrEmpty(file) && Path.IsPathRooted(file) && File.Exists(file) && seen.Add(file)) list.Add(new ScreenRoomBrowserChoice(name, file));
        };
        try {
            uint size = 0;
            AssocQueryString(0, 2, "http", null, null, ref size);
            if (size > 0 && size <= 32768) {
                var value = new StringBuilder((int)size);
                if (AssocQueryString(0, 2, "http", null, value, ref size) == 0) {
                    string file = value.ToString();
                    var allowed = new[] { "chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "vivaldi.exe", "opera.exe", "QQBrowser.exe", "360se.exe" };
                    if (allowed.Contains(Path.GetFileName(file), StringComparer.OrdinalIgnoreCase)) add("系统默认浏览器（直接打开）", file);
                }
            }
        } catch { /* Broken protocol registration must not prevent the explicit choices. */ }
        foreach (string root in new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) }) {
            if (string.IsNullOrEmpty(root)) continue;
            add("Google Chrome", Path.Combine(root, "Google", "Chrome", "Application", "chrome.exe"));
            add("Microsoft Edge", Path.Combine(root, "Microsoft", "Edge", "Application", "msedge.exe"));
            add("Mozilla Firefox", Path.Combine(root, "Mozilla Firefox", "firefox.exe"));
            add("Brave", Path.Combine(root, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"));
        }
        return list;
    }

    internal static string Open(int port, string page, ScreenRoomBrowserChoice selected, IEnumerable<ScreenRoomBrowserChoice> choices, Func<ProcessStartInfo, bool> launch)
    {
        string url = Address(port, page);
        if (selected != null && selected.Executable != null) {
            if (Direct(selected, url, launch)) return selected.Name;
            throw new InvalidOperationException("无法启动所选浏览器。请切换浏览器或复制地址手动打开。");
        }
        foreach (var browser in choices.Where(c => c.Executable != null)) if (Direct(browser, url, launch)) return browser.Name;
        try { if (launch(new ProcessStartInfo(url) { UseShellExecute = true, Verb = "open" })) return "系统 HTTP 关联"; } catch { }
        throw new InvalidOperationException("未能打开浏览器。请先选择已安装的浏览器，或复制地址手动打开。");
    }

    private static bool Direct(ScreenRoomBrowserChoice browser, string url, Func<ProcessStartInfo, bool> launch)
    {
        if (!Path.IsPathRooted(browser.Executable) || !string.Equals(Path.GetExtension(browser.Executable), ".exe", StringComparison.OrdinalIgnoreCase)) return false;
        try { return launch(new ProcessStartInfo(browser.Executable, "\"" + url + "\"") { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(browser.Executable) }); }
        catch { return false; }
    }
}
