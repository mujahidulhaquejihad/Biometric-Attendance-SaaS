using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using SourceAFIS;

namespace BridgeAgent;

public sealed record PunchDto(string Code, string? Time = null, string? LocalTime = null, string? Serial = null, string? VerifyMode = null);
public sealed record EmployeeDto(string Code, string Name, string? PhotoUrl);
public sealed record TemplateDto(string Code, int Finger, string Template);
public sealed record PullDeviceDto(string Serial, string Ip, int? Port);
public sealed record SyncResponse(EmployeeDto[] Employees, TemplateDto[] Templates, PullDeviceDto[] PullDevices);

/// <summary>Durable outbox: punches survive network outages and agent restarts.</summary>
public sealed class OfflineQueue
{
    readonly string cs;

    public OfflineQueue(AgentOptions o)
    {
        Directory.CreateDirectory(o.DataDir);
        cs = $"Data Source={Path.Combine(o.DataDir, "agent.db")}";
        Exec("CREATE TABLE IF NOT EXISTS queue(id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);" +
             "CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT NOT NULL);");
    }

    SqliteConnection Open() { var c = new SqliteConnection(cs); c.Open(); return c; }

    void Exec(string sql, params (string, object)[] args)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (k, v) in args) cmd.Parameters.AddWithValue(k, v);
        cmd.ExecuteNonQuery();
    }

    public void Enqueue(PunchDto p) => Exec("INSERT INTO queue(json) VALUES($j)", ("$j", JsonSerializer.Serialize(p, Json.Opts)));

    public List<(long Id, PunchDto Punch)> Peek(int n)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT id, json FROM queue ORDER BY id LIMIT $n";
        cmd.Parameters.AddWithValue("$n", n);
        using var r = cmd.ExecuteReader();
        var list = new List<(long, PunchDto)>();
        while (r.Read()) list.Add((r.GetInt64(0), JsonSerializer.Deserialize<PunchDto>(r.GetString(1), Json.Opts)!));
        return list;
    }

    public void Delete(IEnumerable<long> ids)
    {
        using var c = Open();
        using var tx = c.BeginTransaction();
        foreach (var id in ids)
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = "DELETE FROM queue WHERE id = $id";
            cmd.Parameters.AddWithValue("$id", id);
            cmd.ExecuteNonQuery();
        }
        tx.Commit();
    }

    public long Count()
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM queue";
        return (long)cmd.ExecuteScalar()!;
    }

    public string? Get(string k)
    {
        using var c = Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT v FROM kv WHERE k = $k";
        cmd.Parameters.AddWithValue("$k", k);
        return cmd.ExecuteScalar() as string;
    }

    public void Set(string k, string v) => Exec("INSERT INTO kv(k, v) VALUES($k, $v) ON CONFLICT(k) DO UPDATE SET v = excluded.v", ("$k", k), ("$v", v));
}

/// <summary>Employees and fingerprint templates for this branch, refreshed from the server.</summary>
public sealed class AgentState
{
    volatile Dictionary<string, string> names = new();
    volatile List<(string Code, FingerprintTemplate Template)> templates = new();
    readonly ConcurrentDictionary<string, byte> seen = new();

    public PullDeviceDto[] PullDevices { get; private set; } = [];
    public DateTime? LastSync { get; set; }
    public string? LastError { get; set; }
    public int EmployeeCount => names.Count;
    public int TemplateCount => templates.Count;

    public void Load(SyncResponse s)
    {
        names = s.Employees.ToDictionary(e => e.Code, e => e.Name);
        var list = new List<(string, FingerprintTemplate)>();
        foreach (var t in s.Templates)
        {
            try { list.Add((t.Code, new FingerprintTemplate(Convert.FromBase64String(t.Template)))); }
            catch { /* skip corrupt or non-SourceAFIS template */ }
        }
        templates = list;
        PullDevices = s.PullDevices;
    }

    public void AddTemplate(string code, byte[] template) =>
        templates = [.. templates, (code, new FingerprintTemplate(template))];

    public string NameOf(string code) => names.TryGetValue(code, out var n) ? n : code;

    // ponytail: linear 1:N scan; fine to ~5-10k templates per site. Beyond that, shard by branch or pre-filter candidates.
    public (string Code, double Score)? Identify(FingerprintTemplate probe, double threshold)
    {
        var matcher = new FingerprintMatcher(probe);
        string? best = null;
        double bestScore = 0;
        foreach (var (code, t) in templates)
        {
            var s = matcher.Match(t);
            if (s > bestScore) { bestScore = s; best = code; }
        }
        return best is not null && bestScore >= threshold ? (best, bestScore) : null;
    }

    public void MarkSeen(string serial) => seen[serial] = 0;
    public string[] TakeSeen() { var s = seen.Keys.ToArray(); foreach (var k in s) seen.TryRemove(k, out _); return s; }
}

public sealed class CloudClient
{
    readonly HttpClient http;

    public CloudClient(AgentOptions o)
    {
        http = new HttpClient { BaseAddress = new Uri(o.ServerUrl.TrimEnd('/') + "/"), Timeout = TimeSpan.FromSeconds(30) };
        http.DefaultRequestHeaders.Authorization = new("Bearer", o.DeviceToken);
    }

    public async Task<SyncResponse> Sync(CancellationToken ct) =>
        await http.GetFromJsonAsync<SyncResponse>("api/agent/sync", Json.Opts, ct) ?? throw new InvalidOperationException("Empty sync response");

    public async Task PostPunches(IReadOnlyList<PunchDto> punches, string[] seen, CancellationToken ct)
    {
        using var r = await http.PostAsJsonAsync("api/agent/punches", new { punches, seen }, Json.Opts, ct);
        r.EnsureSuccessStatusCode();
    }

    /// <returns>null on success, otherwise the server's error message.</returns>
    public async Task<string?> PostTemplate(string code, int finger, byte[] template, CancellationToken ct)
    {
        using var r = await http.PostAsJsonAsync("api/agent/templates", new { code, finger, template = Convert.ToBase64String(template) }, Json.Opts, ct);
        if (r.IsSuccessStatusCode) return null;
        var body = await r.Content.ReadAsStringAsync(ct);
        try { return JsonDocument.Parse(body).RootElement.GetProperty("error").GetString(); } catch { return $"Server returned {(int)r.StatusCode}"; }
    }
}
