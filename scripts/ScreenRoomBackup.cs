using System;
using System.IO;
using System.IO.Compression;
using System.Linq;

internal static class ScreenRoomBackup
{
    private static bool IsLink(string file)
    {
        return (File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0;
    }

    internal static void Create(string project, string destination)
    {
        var data = Path.GetFullPath(Path.Combine(project, "data"));
        var library = Path.Combine(data, "library.json");
        destination = Path.GetFullPath(destination);
        if (!Path.GetExtension(destination).Equals(".zip", StringComparison.OrdinalIgnoreCase) ||
            (File.Exists(destination) && IsLink(destination))) throw new InvalidOperationException("请选择普通 ZIP 文件作为备份目标。");
        if (destination.StartsWith(data + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("请把备份保存到网站数据目录以外。");
        if (!File.Exists(library)) throw new InvalidOperationException("还没有网站资料，请先启动网站并完成首次设置。");
        if (IsLink(data) || IsLink(library)) throw new InvalidOperationException("数据目录或资料文件是链接，未创建备份。");
        var covers = Path.Combine(data, "covers");
        if (Directory.Exists(covers) && IsLink(covers)) throw new InvalidOperationException("封面目录是链接，未创建备份。");
        var temp = Path.Combine(Path.GetDirectoryName(destination), ".screenroom-" + Guid.NewGuid().ToString("N") + ".partial");
        bool created = false;
        try
        {
            using (var output = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                created = true;
                using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true))
                {
                    Add(zip, library, "data/library.json");
                    if (Directory.Exists(covers))
                    {
                        var types = new[] { ".jpg", ".jpeg", ".png", ".webp" };
                        foreach (var file in Directory.EnumerateFiles(covers))
                        {
                            if (types.Contains(Path.GetExtension(file), StringComparer.OrdinalIgnoreCase) && !IsLink(file))
                                Add(zip, file, "data/covers/" + Path.GetFileName(file));
                        }
                    }
                }
                output.Flush(true);
            }
            if (File.Exists(destination)) File.Replace(temp, destination, null);
            else File.Move(temp, destination);
            created = false;
        }
        finally { if (created) File.Delete(temp); }
    }

    private static void Add(ZipArchive zip, string file, string name)
    {
        // library.json is replaced atomically by the server; the open handle reads a single version.
        using (var input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete))
        using (var output = zip.CreateEntry(name, CompressionLevel.Fastest).Open())
            input.CopyTo(output);
    }
}
