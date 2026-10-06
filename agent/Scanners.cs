using System.Buffers.Binary;
using System.Diagnostics;
using System.Runtime.InteropServices;
using SourceAFIS;

namespace BridgeAgent;

public sealed record FingerImage(byte[] Pixels, int Width, int Height, int Dpi);

/// <summary>One USB fingerprint reader. Capture returns a grayscale image or null on timeout/bad read.</summary>
public interface IScanner : IDisposable
{
    string Name { get; }
    FingerImage? Capture(int timeoutMs);
}

/// <summary>Owns the scanner; turns images into vendor-neutral SourceAFIS templates.</summary>
public sealed class ScannerService : IDisposable
{
    readonly IScanner? scanner;
    readonly SemaphoreSlim gate = new(1, 1);
    readonly double threshold;

    public ScannerService(AgentOptions o, ILogger<ScannerService> log)
    {
        threshold = o.MatchThreshold;
        scanner = ScannerFactory.Open(o.Scanner, log);
    }

    public string Name => scanner?.Name ?? "none";
    public bool Ready => scanner is not null;

    static FingerprintTemplate ToTemplate(FingerImage img) =>
        new(new FingerprintImage(img.Width, img.Height, img.Pixels, new FingerprintImageOptions { Dpi = img.Dpi }));

    public async Task<FingerprintTemplate?> TryCapture(int timeoutMs, CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            var img = await Task.Run(() => scanner!.Capture(timeoutMs), ct);
            return img is null ? null : ToTemplate(img);
        }
        finally { gate.Release(); }
    }

    /// <summary>Three captures; keeps the sample that agrees best with the other two.</summary>
    public async Task<(byte[]? Template, string? Error)> Enroll(Func<int, Task> progress, CancellationToken ct)
    {
        if (scanner is null) return (null, "No fingerprint scanner connected");
        await gate.WaitAsync(ct);
        try
        {
            var samples = new List<FingerprintTemplate>();
            for (var step = 1; step <= 3; step++)
            {
                await progress(step);
                var img = await Task.Run(() => scanner.Capture(15_000), ct);
                if (img is null) return (null, "No finger detected. Try again.");
                samples.Add(ToTemplate(img));
                await Task.Delay(1200, ct);
            }
            var scores = new double[3];
            var worst = double.MaxValue;
            for (var i = 0; i < 3; i++)
            {
                var m = new FingerprintMatcher(samples[i]);
                for (var j = 0; j < 3; j++)
                {
                    if (i == j) continue;
                    var s = m.Match(samples[j]);
                    scores[i] += s;
                    worst = Math.Min(worst, s);
                }
            }
            if (worst < threshold) return (null, "The three scans did not match each other. Clean the sensor and try again.");
            return (samples[Array.IndexOf(scores, scores.Max())].ToByteArray(), null);
        }
        finally { gate.Release(); }
    }

    public void Dispose() => scanner?.Dispose();
}

public static class ScannerFactory
{
    public static IScanner? Open(string preferred, ILogger log)
    {
        var candidates = new List<(string Key, Func<IScanner> Make)>();
#if SECUGEN
        candidates.Add(("secugen", () => new SecuGenScanner()));
#endif
#if DIGITALPERSONA
        candidates.Add(("digitalpersona", () => new DigitalPersonaScanner()));
#endif
#if ZKFINGER
        candidates.Add(("zk", () => new ZkFingerScanner()));
#endif
        candidates.Add(("wbf", () => new WbfScanner()));

        foreach (var (key, make) in candidates.Where(c => preferred is "auto" || c.Key.Equals(preferred, StringComparison.OrdinalIgnoreCase)))
        {
            try
            {
                var s = make();
                log.LogInformation("Using {Scanner} fingerprint scanner", s.Name);
                return s;
            }
            catch (Exception e) { log.LogInformation("{Key} scanner unavailable: {Message}", key, e.Message); }
        }
        log.LogWarning("No fingerprint scanner found; agent will only relay LAN terminals.");
        return null;
    }
}

/// <summary>
/// Windows Biometric Framework: works with any WBF-compliant reader without a vendor SDK.
/// Raw capture needs admin/LocalSystem (the service account) and a sensor that allows raw access;
/// "Enhanced Sign-in Security" sensors refuse it, so use the vendor SDK for those.
/// </summary>
public sealed class WbfScanner : IScanner
{
    const uint WINBIO_TYPE_FINGERPRINT = 0x08, WINBIO_POOL_SYSTEM = 1, WINBIO_FLAG_RAW = 0x01;
    const byte WINBIO_PURPOSE_IDENTIFY = 0x02, WINBIO_DATA_FLAG_RAW = 0x20;

    [DllImport("winbio.dll")] static extern int WinBioOpenSession(uint factor, uint poolType, uint flags, IntPtr unitArray, nuint unitCount, IntPtr databaseId, out IntPtr session);
    [DllImport("winbio.dll")] static extern int WinBioCaptureSample(IntPtr session, byte purpose, byte flags, out uint unitId, out IntPtr sample, out nuint sampleSize, out uint rejectDetail);
    [DllImport("winbio.dll")] static extern int WinBioCancel(IntPtr session);
    [DllImport("winbio.dll")] static extern int WinBioFree(IntPtr address);
    [DllImport("winbio.dll")] static extern int WinBioCloseSession(IntPtr session);

    readonly IntPtr session;

    public WbfScanner()
    {
        var hr = WinBioOpenSession(WINBIO_TYPE_FINGERPRINT, WINBIO_POOL_SYSTEM, WINBIO_FLAG_RAW, IntPtr.Zero, 0, (IntPtr)1 /* WINBIO_DB_DEFAULT */, out session);
        if (hr != 0) throw new InvalidOperationException($"WinBioOpenSession failed: 0x{hr:X8}");
    }

    public string Name => "Windows Biometric Framework";

    public FingerImage? Capture(int timeoutMs)
    {
        IntPtr sample = IntPtr.Zero;
        nuint size = 0;
        var call = Task.Run(() => WinBioCaptureSample(session, WINBIO_PURPOSE_IDENTIFY, WINBIO_DATA_FLAG_RAW, out _, out sample, out size, out _));
        if (!call.Wait(timeoutMs)) { WinBioCancel(session); call.Wait(); }
        if (call.Result != 0 || sample == IntPtr.Zero) return null;
        try
        {
            var bir = new byte[(int)size];
            Marshal.Copy(sample, bir, 0, bir.Length);
            // WINBIO_BIR: HeaderBlock{Size,Offset}, StandardDataBlock{Size,Offset}, ...
            var stdSize = BitConverter.ToInt32(bir, 8);
            var stdOffset = BitConverter.ToInt32(bir, 12);
            return ParseIso19794_4(bir.AsSpan(stdOffset, stdSize));
        }
        finally { WinBioFree(sample); }
    }

    /// <summary>ANSI INCITS 381 / ISO 19794-4 finger image record (uncompressed, 8-bit) -> pixels.</summary>
    internal static FingerImage? ParseIso19794_4(ReadOnlySpan<byte> r)
    {
        if (r.Length < 46 || r[0] != 'F' || r[1] != 'I' || r[2] != 'R') return null;
        // ANSI's general header is 36 bytes (has a CBEFF product id); ISO's is 32. Pick the one whose
        // finger record length matches its declared image size.
        foreach (var header in new[] { 36, 32 })
        {
            if (r.Length < header + 14) continue;
            var recLen = BinaryPrimitives.ReadUInt32BigEndian(r[header..]);
            var w = BinaryPrimitives.ReadUInt16BigEndian(r[(header + 9)..]);
            var h = BinaryPrimitives.ReadUInt16BigEndian(r[(header + 11)..]);
            if (w == 0 || h == 0 || recLen != (uint)(w * h + 14) || r.Length < header + 14 + w * h) continue;
            var resOffset = header == 36 ? 28 : 24;
            var scaleUnits = r[header == 36 ? 23 : 19];
            var compression = r[header == 36 ? 33 : 29];
            if (compression != 0) return null;
            int res = BinaryPrimitives.ReadUInt16BigEndian(r[resOffset..]);
            var dpi = scaleUnits == 2 ? (int)Math.Round(res * 2.54) : res;
            return new FingerImage(r.Slice(header + 14, w * h).ToArray(), w, h, dpi is >= 250 and <= 1500 ? dpi : 500);
        }
        return null;
    }

    public void Dispose() => WinBioCloseSession(session);
}

#if SECUGEN
public sealed class SecuGenScanner : IScanner
{
    readonly SecuGen.FDxSDKPro.Windows.SGFingerPrintManager m = new();
    readonly int w, h, dpi;

    public SecuGenScanner()
    {
        var err = m.Init(SecuGen.FDxSDKPro.Windows.SGFPMDeviceName.DEV_AUTO);
        if (err == 0) err = m.OpenDevice((int)SecuGen.FDxSDKPro.Windows.SGFPMPortAddr.USB_AUTO_DETECT);
        if (err != 0) throw new InvalidOperationException($"SecuGen error {err}");
        var info = new SecuGen.FDxSDKPro.Windows.SGFPMDeviceInfoParam();
        m.GetDeviceInfo(info);
        (w, h, dpi) = (info.ImageWidth, info.ImageHeight, info.ImageDPI);
    }

    public string Name => "SecuGen";

    public FingerImage? Capture(int timeoutMs)
    {
        var buf = new byte[w * h];
        return m.GetImageEx(buf, timeoutMs, 0, 50) == 0 ? new FingerImage(buf, w, h, dpi) : null;
    }

    public void Dispose() => m.CloseDevice();
}
#endif

#if DIGITALPERSONA
public sealed class DigitalPersonaScanner : IScanner
{
    readonly DPUruNet.Reader reader;

    public DigitalPersonaScanner()
    {
        var readers = DPUruNet.ReaderCollection.GetReaders();
        if (readers.Count == 0) throw new InvalidOperationException("No U.are.U reader attached");
        reader = readers[0];
        if (reader.Open(DPUruNet.Constants.CapturePriority.DP_PRIORITY_COOPERATIVE) != DPUruNet.Constants.ResultCode.DP_SUCCESS)
            throw new InvalidOperationException("Could not open U.are.U reader");
        reader.GetStatus();
    }

    public string Name => "DigitalPersona U.are.U";

    public FingerImage? Capture(int timeoutMs)
    {
        var dpi = reader.Capabilities.Resolutions[0];
        var r = reader.Capture(DPUruNet.Constants.Formats.Fid.ANSI, DPUruNet.Constants.CaptureProcessing.DP_IMG_PROC_DEFAULT, timeoutMs, dpi);
        if (r.ResultCode != DPUruNet.Constants.ResultCode.DP_SUCCESS || r.Data is null || r.Quality != DPUruNet.Constants.CaptureQuality.DP_QUALITY_GOOD) return null;
        var v = r.Data.Views[0];
        return new FingerImage(v.RawImage, v.Width, v.Height, dpi);
    }

    public void Dispose() => reader.Dispose();
}
#endif

#if ZKFINGER
public sealed class ZkFingerScanner : IScanner
{
    readonly IntPtr dev;
    readonly int w, h;

    public ZkFingerScanner()
    {
        if (libzkfpcsharp.zkfp2.Init() != 0 || libzkfpcsharp.zkfp2.GetDeviceCount() <= 0) throw new InvalidOperationException("No ZKTeco USB reader attached");
        dev = libzkfpcsharp.zkfp2.OpenDevice(0);
        if (dev == IntPtr.Zero) throw new InvalidOperationException("Could not open ZKTeco reader");
        var p = new byte[4];
        var size = 4;
        libzkfpcsharp.zkfp2.GetParameters(dev, 1, p, ref size);
        w = BitConverter.ToInt32(p, 0);
        size = 4;
        libzkfpcsharp.zkfp2.GetParameters(dev, 2, p, ref size);
        h = BitConverter.ToInt32(p, 0);
    }

    public string Name => "ZKTeco USB (ZK9500/SLK20R)";

    public FingerImage? Capture(int timeoutMs)
    {
        var img = new byte[w * h];
        var tmp = new byte[2048];
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            var len = tmp.Length;
            if (libzkfpcsharp.zkfp2.AcquireFingerprint(dev, img, tmp, ref len) == 0) return new FingerImage(img, w, h, 500);
            Thread.Sleep(100);
        }
        return null;
    }

    public void Dispose()
    {
        libzkfpcsharp.zkfp2.CloseDevice(dev);
        libzkfpcsharp.zkfp2.Terminate();
    }
}
#endif
