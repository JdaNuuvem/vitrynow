using System;
using System.IO;
using System.Net;

namespace MeuCardapio.PrintClient.Services
{
    public class UpdateException : Exception { public UpdateException(string m) : base(m) { } }

    public interface IUpdateTransport
    {
        byte[] GetSmall(Uri url, int maxBytes);
        void Download(Uri url, string destPath, long maxBytes);
    }

    // HTTP real: TLS 1.2, sem redirecionamento (a URL já foi validada; seguir um 30x poderia levar
    // a http:// ou a outro host), timeouts curtos, tamanho máximo, HTTP 200 obrigatório.
    public sealed class HttpUpdateTransport : IUpdateTransport
    {
        public int TimeoutMs = 15000;
        public int ReadTimeoutMs = 30000;

        HttpWebRequest Open(Uri url)
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.AllowAutoRedirect = false;
            req.Timeout = TimeoutMs;
            req.ReadWriteTimeout = ReadTimeoutMs;
            req.UserAgent = Brand.UserAgentProduct + "/" + Updater.CurrentVersion;
            return req;
        }

        public byte[] GetSmall(Uri url, int maxBytes)
        {
            using (var resp = Fetch(url))
            using (var s = resp.GetResponseStream())
            using (var ms = new MemoryStream())
            {
                Copy(s, ms, maxBytes);
                return ms.ToArray();
            }
        }

        public void Download(Uri url, string destPath, long maxBytes)
        {
            using (var resp = Fetch(url))
            {
                if (resp.ContentLength > maxBytes) throw new UpdateException("arquivo maior que o permitido");
                using (var s = resp.GetResponseStream())
                using (var fs = new FileStream(destPath, FileMode.Create, FileAccess.Write, FileShare.None))
                    Copy(s, fs, maxBytes);
            }
        }

        HttpWebResponse Fetch(Uri url)
        {
            try
            {
                var resp = (HttpWebResponse)Open(url).GetResponse();
                if (resp.StatusCode != HttpStatusCode.OK)
                {
                    var code = (int)resp.StatusCode;
                    resp.Dispose();
                    throw new UpdateException("servidor respondeu " + code + " (redirecionamentos não são seguidos)");
                }
                return resp;
            }
            catch (WebException ex)
            {
                var r = ex.Response as HttpWebResponse;
                if (r != null)
                {
                    var code = (int)r.StatusCode;
                    r.Dispose();
                    throw new UpdateException("servidor respondeu " + code + " (redirecionamentos não são seguidos)");
                }
                throw new UpdateException("falha de rede: " + ex.Status);
            }
        }

        static void Copy(Stream from, Stream to, long max)
        {
            var buf = new byte[64 * 1024];
            long total = 0; int n;
            while ((n = from.Read(buf, 0, buf.Length)) > 0)
            {
                total += n;
                if (total > max) throw new UpdateException("arquivo maior que o permitido");
                to.Write(buf, 0, n);
            }
        }
    }
}
