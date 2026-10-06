using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text.Json;
using System.Text.Json.Serialization;
using BridgeAgent;

if (args.Contains("--selftest")) { SelfTest.Run(); return; }

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseWindowsService(o => o.ServiceName = "Attendance Bridge Agent");

var opts = builder.Configuration.GetSection("Agent").Get<AgentOptions>() ?? new AgentOptions();
if (string.IsNullOrWhiteSpace(opts.ServerUrl) || string.IsNullOrWhiteSpace(opts.DeviceToken))
    throw new InvalidOperationException("Set Agent:ServerUrl and Agent:DeviceToken in appsettings.json");
if (opts.AllowedOrigins.Length == 0)
    opts.AllowedOrigins = [new Uri(opts.ServerUrl).GetLeftPart(UriPartial.Authority)];

builder.WebHost.ConfigureKestrel(k => k.ListenLocalhost(opts.Port));
builder.Services.AddSingleton(opts);
builder.Services.AddSingleton<OfflineQueue>();
builder.Services.AddSingleton<AgentState>();
builder.Services.AddSingleton<CloudClient>();
builder.Services.AddSingleton<ScannerService>();
builder.Services.AddSingleton<KioskHub>();
builder.Services.AddHostedService<ScanWorker>();
builder.Services.AddHostedService<SyncWorker>();
builder.Services.AddHostedService<ZkPullWorker>();

var app = builder.Build();
app.UseWebSockets();

app.MapGet("/", (ScannerService scanner, AgentState state, OfflineQueue queue) => Results.Content($"""
    <html><body style="font-family:sans-serif;padding:2rem">
    <h2>Attendance Bridge Agent</h2>
    <p>Scanner: <b>{scanner.Name}</b> ({(scanner.Ready ? "ready" : "not found")})</p>
    <p>Employees cached: {state.EmployeeCount} &middot; fingerprints cached: {state.TemplateCount}</p>
    <p>Last sync: {state.LastSync?.ToLocalTime().ToString() ?? "never"} {System.Net.WebUtility.HtmlEncode(state.LastError)}</p>
    <p>Punches waiting to upload: {queue.Count()}</p>
    <p>LAN-polled terminals: {string.Join(", ", state.PullDevices.Select(d => $"{d.Serial} ({d.Ip})"))}</p>
    </body></html>
    """, "text/html"));

app.Map("/ws", async (HttpContext ctx, KioskHub hub) =>
{
    if (!ctx.WebSockets.IsWebSocketRequest) { ctx.Response.StatusCode = 400; return; }
    // Any website can open ws://localhost; only the attendance app may drive the scanner.
    var origin = ctx.Request.Headers.Origin.ToString();
    if (!opts.AllowedOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase)) { ctx.Response.StatusCode = 403; return; }
    using var ws = await ctx.WebSockets.AcceptWebSocketAsync();
    await hub.Serve(ws, ctx.RequestAborted);
});

app.Run();

namespace BridgeAgent
{
    public sealed class AgentOptions
    {
        public string ServerUrl { get; set; } = "";
        public string DeviceToken { get; set; } = "";
        public string Scanner { get; set; } = "auto";
        public double MatchThreshold { get; set; } = 40;
        public int Port { get; set; } = 47800;
        public string[] AllowedOrigins { get; set; } = [];
        public string DataDir { get; set; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "AttendanceBridgeAgent");
    }

    /// <summary>`BridgeAgent.exe --selftest`: checks the protocol parsers without hardware.</summary>
    public static class SelfTest
    {
        static void Check(bool ok, string what) { if (!ok) throw new Exception("FAILED: " + what); Console.WriteLine("ok   " + what); }

        public static void Run()
        {
            // ZK packed time for 2024-03-15 08:30:05: ((((y%100)*12*31 + (m-1)*31 + d-1)*24 + h)*60 + mi)*60 + s
            uint t = (uint)((((24 * 12 * 31 + 2 * 31 + 14) * 24 + 8) * 60 + 30) * 60 + 5);
            var rec = new byte[4 + 40];
            BitConverter.TryWriteBytes(rec.AsSpan(0), 40);
            System.Text.Encoding.ASCII.GetBytes("1007").CopyTo(rec, 4 + 2);
            BitConverter.TryWriteBytes(rec.AsSpan(4 + 27), t);
            var logs = ZkClient.Parse(rec);
            Check(logs.Count == 1 && logs[0].Code == "1007" && logs[0].Time == new DateTime(2024, 3, 15, 8, 30, 5), "ZK 40-byte attendance record");

            // ISO 19794-4 record: 32-byte general header + 14-byte finger header + 2x3 pixels at 500 dpi.
            var iso = new byte[32 + 14 + 6];
            "FIR\0"u8.CopyTo(iso);
            iso[19] = 1; // pixels per inch
            iso[24] = 0x01; iso[25] = 0xF4; // 500
            iso[32 + 3] = 20; // finger record length = 14 + 6
            iso[32 + 10] = 2; iso[32 + 12] = 3; // width 2, height 3
            for (var i = 0; i < 6; i++) iso[46 + i] = (byte)(i * 40);
            var img = WbfScanner.ParseIso19794_4(iso);
            Check(img is { Width: 2, Height: 3, Dpi: 500 } && img.Pixels[5] == 200, "ISO 19794-4 finger image");
            Console.WriteLine("All checks passed.");
        }
    }

    public static class Json
    {
        public static readonly JsonSerializerOptions Opts = new(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
    }

    /// <summary>Kiosk and enrollment pages connect here over ws://localhost.</summary>
    public sealed class KioskHub(ScannerService scanner, CloudClient cloud, AgentState state, ILogger<KioskHub> log)
    {
        sealed record Client(WebSocket Ws, SemaphoreSlim Lock);
        readonly ConcurrentDictionary<Guid, Client> clients = new();

        public async Task Broadcast(object msg)
        {
            foreach (var (id, c) in clients)
                if (!await Send(c, msg)) clients.TryRemove(id, out _);
        }

        static async Task<bool> Send(Client c, object msg)
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(msg, Json.Opts);
            await c.Lock.WaitAsync();
            try
            {
                if (c.Ws.State != WebSocketState.Open) return false;
                await c.Ws.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
                return true;
            }
            catch { return false; }
            finally { c.Lock.Release(); }
        }

        public async Task Serve(WebSocket ws, CancellationToken ct)
        {
            var id = Guid.NewGuid();
            var client = new Client(ws, new SemaphoreSlim(1, 1));
            clients[id] = client;
            await Send(client, new { type = "hello", scanner = scanner.Name, ready = scanner.Ready, employees = state.EmployeeCount });
            var buf = new byte[16 * 1024];
            try
            {
                while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
                {
                    var r = await ws.ReceiveAsync(buf, ct);
                    if (r.MessageType == WebSocketMessageType.Close) break;
                    using var doc = JsonDocument.Parse(buf.AsMemory(0, r.Count));
                    var root = doc.RootElement;
                    if (root.TryGetProperty("type", out var t) && t.GetString() == "enroll")
                    {
                        var code = root.GetProperty("code").GetString() ?? "";
                        var finger = root.GetProperty("finger").GetInt32();
                        _ = Enroll(client, code, finger, ct);
                    }
                }
            }
            catch (Exception e) when (e is OperationCanceledException or WebSocketException or JsonException) { }
            finally { clients.TryRemove(id, out _); }
        }

        async Task Enroll(Client c, string code, int finger, CancellationToken ct)
        {
            try
            {
                if (finger is < 0 or > 9 || code.Length is 0 or > 24) throw new ArgumentException("Invalid employee code or finger");
                var (template, error) = await scanner.Enroll(step => Send(c, new { type = "progress", step, of = 3 }), ct);
                if (template is null) { await Send(c, new { type = "enrolled", ok = false, error }); return; }
                var uploadError = await cloud.PostTemplate(code, finger, template, ct);
                if (uploadError is null) state.AddTemplate(code, template);
                await Send(c, new { type = "enrolled", ok = uploadError is null, error = uploadError });
            }
            catch (Exception e)
            {
                log.LogWarning(e, "Enrollment failed");
                await Send(c, new { type = "enrolled", ok = false, error = e.Message });
            }
        }
    }
}
