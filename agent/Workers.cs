namespace BridgeAgent;

/// <summary>Continuously captures from the USB scanner, identifies 1:N, and queues punches.</summary>
public sealed class ScanWorker(ScannerService scanner, AgentState state, OfflineQueue queue, KioskHub hub, AgentOptions opts, ILogger<ScanWorker> log) : BackgroundService
{
    readonly Dictionary<string, DateTime> lastPunch = new();

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            if (!scanner.Ready) { await Task.Delay(5000, ct); continue; }
            try
            {
                // Short capture windows so enrollment can take the scanner between attempts.
                var probe = await scanner.TryCapture(1500, ct);
                if (probe is null) continue;
                var match = state.Identify(probe, opts.MatchThreshold);
                if (match is null)
                {
                    await hub.Broadcast(new { type = "unknown" });
                }
                else
                {
                    var (code, score) = match.Value;
                    var now = DateTime.UtcNow;
                    // Ignore a second scan of the same finger within 30s (people double-tap).
                    if (!lastPunch.TryGetValue(code, out var prev) || now - prev > TimeSpan.FromSeconds(30))
                    {
                        lastPunch[code] = now;
                        queue.Enqueue(new PunchDto(code, Time: now.ToString("O"), VerifyMode: "FINGERPRINT"));
                    }
                    await hub.Broadcast(new { type = "punch", code, name = state.NameOf(code), time = now.ToString("O"), score = Math.Round(score) });
                }
                await Task.Delay(1500, ct); // let the finger lift
            }
            catch (OperationCanceledException) { }
            catch (Exception e)
            {
                log.LogWarning(e, "Capture failed");
                await Task.Delay(3000, ct);
            }
        }
    }
}

/// <summary>Uploads queued punches every 10s and refreshes employees/templates every 5 minutes.</summary>
public sealed class SyncWorker(CloudClient cloud, AgentState state, OfflineQueue queue, ILogger<SyncWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var nextSync = DateTime.MinValue;
        while (!ct.IsCancellationRequested)
        {
            if (DateTime.UtcNow >= nextSync)
            {
                try
                {
                    state.Load(await cloud.Sync(ct));
                    state.LastSync = DateTime.UtcNow;
                    state.LastError = null;
                    nextSync = DateTime.UtcNow.AddMinutes(5);
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    state.LastError = e.Message;
                    log.LogWarning("Sync failed: {Message}", e.Message);
                    nextSync = DateTime.UtcNow.AddSeconds(30);
                }
            }

            try
            {
                List<(long Id, PunchDto Punch)> batch;
                while ((batch = queue.Peek(500)).Count > 0)
                {
                    await cloud.PostPunches(batch.Select(b => b.Punch).ToList(), state.TakeSeen(), ct);
                    queue.Delete(batch.Select(b => b.Id));
                }
                var seen = state.TakeSeen();
                if (seen.Length > 0) await cloud.PostPunches([], seen, ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                log.LogWarning("Upload failed, will retry: {Message}", e.Message);
            }

            await Task.Delay(10_000, ct);
        }
    }
}

/// <summary>Polls legacy ZKTeco terminals (no ADMS) on the LAN once a minute.</summary>
public sealed class ZkPullWorker(AgentState state, OfflineQueue queue, ILogger<ZkPullWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            foreach (var d in state.PullDevices)
            {
                try
                {
                    using var zk = new ZkClient();
                    await zk.Connect(d.Ip, d.Port ?? 4370, ct);
                    var logs = await zk.GetAttendance(ct);
                    state.MarkSeen(d.Serial);
                    var key = $"zk:{d.Serial}";
                    var last = DateTime.TryParse(queue.Get(key), out var l) ? l : DateTime.MinValue;
                    var fresh = logs.Where(x => x.Time > last).OrderBy(x => x.Time).ToList();
                    foreach (var x in fresh)
                        queue.Enqueue(new PunchDto(x.Code, LocalTime: x.Time.ToString("yyyy-MM-dd HH:mm:ss"), Serial: d.Serial, VerifyMode: "FINGERPRINT"));
                    if (fresh.Count > 0) queue.Set(key, fresh[^1].Time.ToString("O"));
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    log.LogWarning("ZK terminal {Serial} at {Ip}: {Message}", d.Serial, d.Ip, e.Message);
                }
            }
            await Task.Delay(60_000, ct);
        }
    }
}
