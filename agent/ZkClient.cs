using System.Net.Sockets;
using System.Text;

namespace BridgeAgent;

/// <summary>
/// Minimal ZKTeco standalone SDK protocol over TCP 4370: connect and download attendance logs.
/// For terminals without ADMS cloud push.
/// </summary>
// ponytail: no comm-key (password) support and no buffered (>64KB chunked) reads; covers default-configured
// terminals. Add CMD_AUTH and _CMD_PREPARE_BUFFER/_CMD_READ_BUFFER if a site needs them.
public sealed class ZkClient : IDisposable
{
    const ushort CMD_CONNECT = 1000, CMD_EXIT = 1001, CMD_ACK_OK = 2000, CMD_ACK_UNAUTH = 2005;
    const ushort CMD_ATTLOG_RRQ = 13, CMD_PREPARE_DATA = 1500, CMD_DATA = 1501, CMD_FREE_DATA = 1502;

    readonly TcpClient tcp = new();
    NetworkStream stream = null!;
    ushort session;
    ushort reply = ushort.MaxValue - 1;

    public async Task Connect(string ip, int port, CancellationToken ct)
    {
        using var cts = Timeout(ct);
        await tcp.ConnectAsync(ip, port, cts.Token);
        stream = tcp.GetStream();
        var (cmd, sess, _) = await Exchange(CMD_CONNECT, [], ct);
        if (cmd == CMD_ACK_UNAUTH) throw new InvalidOperationException("Terminal has a comm key set; clear it or use ADMS");
        if (cmd != CMD_ACK_OK) throw new InvalidOperationException($"Unexpected connect reply {cmd}");
        session = sess;
    }

    public async Task<List<(string Code, DateTime Time)>> GetAttendance(CancellationToken ct)
    {
        var (cmd, _, data) = await Exchange(CMD_ATTLOG_RRQ, [], ct);
        byte[] payload;
        if (cmd == CMD_DATA) payload = data;
        else if (cmd == CMD_PREPARE_DATA)
        {
            using var ms = new MemoryStream();
            while (true)
            {
                var (c, _, d) = await Read(ct);
                if (c == CMD_DATA) ms.Write(d);
                else if (c == CMD_ACK_OK) break;
            }
            payload = ms.ToArray();
            await Exchange(CMD_FREE_DATA, [], ct);
        }
        else return [];
        return Parse(payload);
    }

    internal static List<(string Code, DateTime Time)> Parse(byte[] payload)
    {
        if (payload.Length < 4) return [];
        var total = Math.Min(BitConverter.ToInt32(payload, 0), payload.Length - 4);
        var recs = payload.AsSpan(4, total);
        // ponytail: record size inferred from length; ambiguous sizes (e.g. 80 bytes) assume the modern 40-byte format.
        var size = recs.Length % 40 == 0 ? 40 : recs.Length % 16 == 0 ? 16 : 8;
        var list = new List<(string, DateTime)>();
        for (var i = 0; i + size <= recs.Length; i += size)
        {
            var r = recs.Slice(i, size);
            switch (size)
            {
                case 40: list.Add((Encoding.ASCII.GetString(r.Slice(2, 24)).Split('\0')[0], Decode(BitConverter.ToUInt32(r.Slice(27, 4))))); break;
                case 16: list.Add((BitConverter.ToUInt32(r[..4]).ToString(), Decode(BitConverter.ToUInt32(r.Slice(4, 4))))); break;
                default: list.Add((BitConverter.ToUInt16(r[..2]).ToString(), Decode(BitConverter.ToUInt32(r.Slice(3, 4))))); break;
            }
        }
        return list.Where(x => x.Item1.Length > 0).ToList();
    }

    static DateTime Decode(uint t)
    {
        var second = (int)(t % 60); t /= 60;
        var minute = (int)(t % 60); t /= 60;
        var hour = (int)(t % 24); t /= 24;
        var day = (int)(t % 31) + 1; t /= 31;
        var month = (int)(t % 12) + 1; t /= 12;
        return new DateTime((int)t + 2000, month, day, hour, minute, second, DateTimeKind.Unspecified);
    }

    async Task<(ushort Cmd, ushort Session, byte[] Data)> Exchange(ushort cmd, byte[] data, CancellationToken ct)
    {
        reply = (ushort)((reply + 1) % ushort.MaxValue);
        var buf = new byte[8 + data.Length];
        BitConverter.TryWriteBytes(buf.AsSpan(0), cmd);
        BitConverter.TryWriteBytes(buf.AsSpan(4), session);
        BitConverter.TryWriteBytes(buf.AsSpan(6), reply);
        data.CopyTo(buf, 8);
        BitConverter.TryWriteBytes(buf.AsSpan(2), Checksum(buf));
        var packet = new byte[8 + buf.Length];
        BitConverter.TryWriteBytes(packet.AsSpan(0), (ushort)0x5050);
        BitConverter.TryWriteBytes(packet.AsSpan(2), (ushort)0x7D82);
        BitConverter.TryWriteBytes(packet.AsSpan(4), (uint)buf.Length);
        buf.CopyTo(packet, 8);
        using var cts = Timeout(ct);
        await stream.WriteAsync(packet, cts.Token);
        return await Read(ct);
    }

    async Task<(ushort Cmd, ushort Session, byte[] Data)> Read(CancellationToken ct)
    {
        var top = await ReadExact(8, ct);
        if (BitConverter.ToUInt16(top, 0) != 0x5050 || BitConverter.ToUInt16(top, 2) != 0x7D82) throw new InvalidDataException("Bad ZK packet header");
        var len = BitConverter.ToUInt32(top, 4);
        if (len < 8 || len > 16 * 1024 * 1024) throw new InvalidDataException("Bad ZK packet length");
        var body = await ReadExact((int)len, ct);
        return (BitConverter.ToUInt16(body, 0), BitConverter.ToUInt16(body, 4), body[8..]);
    }

    async Task<byte[]> ReadExact(int n, CancellationToken ct)
    {
        var buf = new byte[n];
        using var cts = Timeout(ct);
        await stream.ReadExactlyAsync(buf, cts.Token);
        return buf;
    }

    static CancellationTokenSource Timeout(CancellationToken ct)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(15));
        return cts;
    }

    static ushort Checksum(byte[] p)
    {
        var sum = 0;
        var i = 0;
        for (; i + 1 < p.Length; i += 2)
        {
            sum += p[i] | (p[i + 1] << 8);
            if (sum > ushort.MaxValue) sum -= ushort.MaxValue;
        }
        if (i < p.Length) sum += p[^1];
        while (sum > ushort.MaxValue) sum -= ushort.MaxValue;
        sum = ~sum;
        while (sum < 0) sum += ushort.MaxValue;
        return (ushort)sum;
    }

    public void Dispose()
    {
        try
        {
            if (tcp.Connected) Exchange(CMD_EXIT, [], CancellationToken.None).Wait(2000);
        }
        catch { }
        tcp.Dispose();
    }
}
